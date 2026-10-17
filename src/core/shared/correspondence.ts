import { z } from "zod";

export const correspondenceVariables = ["invitee full name", "invitee first name", "host name", "event name", "date and time", "duration", "location", "manage link", "message"] as const;
export const correspondenceTemplateKeys = ["calendarTitle", "calendarDescription", "confirmationSubject", "confirmationBody", "rescheduleSubject", "rescheduleBody", "cancellationSubject", "cancellationBody", "reminderSubject", "reminderBody", "rescheduleRequestSubject", "rescheduleRequestBody", "rescheduleRequestReminderSubject", "rescheduleRequestReminderBody"] as const;
export type CorrespondenceVariable = typeof correspondenceVariables[number];
export type CorrespondenceTemplateKey = typeof correspondenceTemplateKeys[number];
export type CorrespondenceQuestion = { key: string; label: string; private?: boolean };
export type CorrespondenceConfig = { templates: Record<CorrespondenceTemplateKey, string | null> };
/** Values are already formatted for the recipient, including the named timezone. */
export type CorrespondenceValues = Record<CorrespondenceVariable, string> & { answers: Readonly<Record<string, string>> };
const questionKeyPattern = /^q_[A-Za-z0-9_-]{10,80}$/u;
const singleLineKey = (key: CorrespondenceTemplateKey) => key === "calendarTitle" || key.endsWith("Subject");

/** Supply current question metadata, including privacy changes, without persistence IO. */
export function correspondenceConfigSchema(questions: readonly CorrespondenceQuestion[] = []) {
  const questionKeys = questions.map(({ key }) => key);
  const shape = Object.fromEntries(correspondenceTemplateKeys.map((key) => [key, z.string().min(1).max(singleLineKey(key) ? 500 : 10_000).nullable().default(null)])) as Record<CorrespondenceTemplateKey, z.ZodDefault<z.ZodNullable<z.ZodString>>>;
  return z.object({ templates: z.object(shape).strict().default(emptyTemplates()) }).strict().superRefine((config, context) => {
    for (const key of correspondenceTemplateKeys) {
      const template = config.templates[key];
      if (template === null) continue;
      if (singleLineKey(key) && hasHeaderControls(template)) context.addIssue({ code: "custom", path: ["templates", key], message: "A title or subject must be a single line." });
      for (const name of invalidTemplateVariables(template, questionKeys)) context.addIssue({ code: "custom", path: ["templates", key], message: `Unknown template variable: ${name}` });
      if (key === "calendarTitle" || key === "calendarDescription") {
        const names = new Set([...template.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]));
        for (const name of ["manage link", "message"]) if (names.has(name)) context.addIssue({ code: "custom", path: ["templates", key], message: `Template variable {${name}} is available in booking emails, not shared calendar invitations.` });
        for (const question of questions) if (question.private && names.has(`answer.${question.key}`)) context.addIssue({ code: "custom", path: ["templates", key], message: `Template variable {answer.${question.key}} is private and cannot appear in a shared calendar.` });
      }
    }
  });
}

export function defaultCorrespondenceConfig(): CorrespondenceConfig {
  return { templates: emptyTemplates() };
}

function emptyTemplates(): CorrespondenceConfig["templates"] {
  return Object.fromEntries(correspondenceTemplateKeys.map((key) => [key, null])) as CorrespondenceConfig["templates"];
}

/** Initial editor text. A null field uses this default in a saved configuration. */
export function defaultCorrespondenceTemplates(questions: readonly CorrespondenceQuestion[] = []): Record<CorrespondenceTemplateKey, string> {
  const answerLines = (visibleQuestions: readonly CorrespondenceQuestion[]) => visibleQuestions.map((question) => {
    if (!questionKeyPattern.test(question.key)) throw new TypeError(`Invalid question key: ${question.key}`);
    // Labels are literal text, never interpreted as user-authored variables.
    return `${question.label.replace(/[{}]/gu, "")}: {answer.${question.key}}`;
  }).join("\n");
  const details = "{event name} with {host name}\nDate and time: {date and time}\nDuration: {duration}\nLocation: {location}";
  const answers = answerLines(questions);
  const calendarAnswers = answerLines(questions.filter((question) => !question.private));
  const body = `${details}${answers ? `\n\n${answers}` : ""}\n\nManage this booking: {manage link}`;
  return {
    calendarTitle: "{event name}: {invitee full name} and {host name}",
    calendarDescription: `${details}${calendarAnswers ? `\n\n${calendarAnswers}` : ""}`,
    confirmationSubject: "Booking confirmed: {event name}",
    confirmationBody: body,
    rescheduleSubject: "Booking rescheduled: {event name}",
    rescheduleBody: `Your booking has been rescheduled.\n\n${body}\n\n{message}`,
    cancellationSubject: "Booking cancelled: {event name}",
    cancellationBody: `Your booking has been cancelled.\n\n${body}\n\n{message}`,
    reminderSubject: "Reminder: {event name}",
    reminderBody: body,
    rescheduleRequestSubject: "Please choose a new time: {event name}",
    rescheduleRequestBody: "{host name} asks you to choose a new time.\n\n{message}\n\n{body}".replace("{body}", body),
    rescheduleRequestReminderSubject: "Reminder to choose a new time: {event name}",
    rescheduleRequestReminderBody: "Please choose a new time for {event name}.\n\n{message}\n\n{body}".replace("{body}", body),
  };
}

/** Reject malformed/unclosed braces as well as unknown, case-sensitive names. */
export function invalidTemplateVariables(template: string, questionKeys: readonly string[] = []): string[] {
  const allowed = new Set<string>(correspondenceVariables);
  for (const key of questionKeys) if (questionKeyPattern.test(key)) allowed.add(`answer.${key}`);
  const invalid = new Set<string>();
  for (const token of template.matchAll(/\{([^{}]*)\}|[{}]/gu)) {
    const name = token[1];
    if (name === undefined) invalid.add(token[0]);
    else if (!allowed.has(name)) invalid.add(name);
  }
  return [...invalid];
}

export function editableCorrespondenceTemplates(config: CorrespondenceConfig, questions: readonly CorrespondenceQuestion[] = []) {
  const defaults = defaultCorrespondenceTemplates(questions);
  return Object.fromEntries(correspondenceTemplateKeys.map((key) => [key, config.templates[key] ?? defaults[key]])) as Record<CorrespondenceTemplateKey, string>;
}

/** One substitution pass: inserted strings cannot introduce further variables. */
export function renderCorrespondenceTemplate(template: string, values: CorrespondenceValues, questionKeys: readonly string[] = Object.keys(values.answers), singleLine = false): string {
  const invalid = invalidTemplateVariables(template, questionKeys);
  if (invalid.length) throw new TypeError(`Unknown template variable: ${invalid.join(", ")}`);
  if (template.length > (singleLine ? 500 : 10_000)) throw new TypeError("Template exceeds its length limit.");
  if (singleLine && hasHeaderControls(template)) throw new TypeError("A title or subject must be a single line.");
  const result = template.replace(/\{([^{}]+)\}/gu, (_, name: string) => {
    const value = name.startsWith("answer.")
      ? Object.hasOwn(values.answers, name.slice(7)) ? values.answers[name.slice(7)] : undefined
      : Object.hasOwn(values, name) ? values[name as CorrespondenceVariable] : undefined;
    if (typeof value !== "string") throw new TypeError(`Missing template value: ${name}`);
    return value;
  });
  const rendered = singleLine ? Array.from(result, character => isHeaderControl(character) ? " " : character).join("").trim() : result;
  if (rendered.length > (singleLine ? 500 : 10_000)) throw new TypeError("Rendered template exceeds its length limit.");
  return rendered;
}

export function renderMailCorrespondence(config: CorrespondenceConfig, kind: "confirmation" | "reschedule" | "cancellation" | "reminder" | "rescheduleRequest" | "rescheduleRequestReminder", values: CorrespondenceValues, options: { questions?: readonly CorrespondenceQuestion[] } = {}) {
  const questions = options.questions ?? [];
  const parsed = z.object({ templates: correspondenceConfigSchema().shape.templates }).strict().parse(config);
  const templates = editableCorrespondenceTemplates(parsed, questions);
  const keys = questions.map(({ key }) => key);
  const subject = renderCorrespondenceTemplate(templates[`${kind}Subject`], values, keys, true);
  const body = renderCorrespondenceTemplate(templates[`${kind}Body`], values, keys);
  return { subject, text: body };
}

/** Calendar templates cannot reference private answers or a manage capability. */
export function renderCalendarCorrespondence(config: CorrespondenceConfig, values: CorrespondenceValues, questions: readonly CorrespondenceQuestion[] = []) {
  const publicQuestions = questions.filter(({ private: isPrivate }) => !isPrivate);
  const keys = publicQuestions.map(({ key }) => key);
  const parsed = correspondenceConfigSchema(questions).parse(config);
  const templates = editableCorrespondenceTemplates(parsed, questions);
  return {
    title: renderCorrespondenceTemplate(templates.calendarTitle, values, keys, true),
    description: renderCorrespondenceTemplate(templates.calendarDescription, values, keys),
  };
}


function isHeaderControl(character: string) { const code = character.charCodeAt(0); return code < 32 || code >= 127 && code <= 159; }
function hasHeaderControls(value: string) { return Array.from(value).some(isHeaderControl); }
