import { retainConfiguredAnswers, type Answers } from "./answer-retention";
import type { PublicEvent } from "./types";

export const attributionKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "source"] as const;
export type Attribution = Partial<Record<typeof attributionKeys[number], string>>;
export type LinkContext = { name?: string; email?: string; answers: Record<string, string[]>; attribution: Attribution; clickIds: { gclid?: string; li_fat_id?: string } };

/** Untrusted, editable suggestions only. No link value supplies identity or booking authority. */
export function readLinkContext(search: string): LinkContext {
  const query = new URLSearchParams(search);
  const attribution: Attribution = {};
  for (const key of attributionKeys) {
    const value = bounded(query.get(key), 500)?.trim();
    if (value) attribution[key] = value;
  }
  const answers = new Map<string, string[]>();
  for (const [key, value] of query) {
    if (!key.startsWith("answer.") || !/^[A-Za-z0-9_-]{1,100}$/.test(key.slice(7)) || value.length > 4000) continue;
    if (!answers.has(key.slice(7)) && answers.size >= 25) continue;
    const values = answers.get(key.slice(7)) ?? [];
    if (values.length < 50 && !values.includes(value)) values.push(value);
    answers.set(key.slice(7), values);
  }
  return { name: bounded(query.get("name"), 160), email: bounded(query.get("email"), 320), answers: Object.fromEntries(answers), attribution, clickIds: Object.fromEntries(["gclid", "li_fat_id"].flatMap(key => { const value = query.get(key); return value && /^[A-Za-z0-9_.~-]{1,500}$/.test(value) ? [[key, value]] : []; })) };
}

export function prefilledAnswers(questions: PublicEvent["questions"], context: LinkContext): Answers {
  const entries: Array<[string, string | string[]]> = [];
  for (const question of questions) {
    const values = context.answers[question.key];
    if (!values?.length) continue;
    if (question.kind === "multiple_choice" || question.kind === "checkbox") entries.push([question.key, values]);
    else if (values[0].length <= (question.kind === "textarea" ? 4000 : 500)) entries.push([question.key, values[0]]);
  }
  return retainConfiguredAnswers(questions, Object.fromEntries(entries));
}

/** Carry only bounded native link fields; never copy arbitrary query parameters. */
export function appendLinkContext(target: URLSearchParams, search: string) {
  const remembered = new URLSearchParams(search).get("remember");
  if (remembered && /^[A-Za-z0-9_-]{43}$/.test(remembered)) target.set("remember",remembered);
  const context = readLinkContext(search);
  for (const key of ["name", "email"] as const) if (context[key] !== undefined && !target.has(key)) target.set(key, context[key]);
  for (const [key, value] of Object.entries(context.clickIds)) if (!target.has(key)) target.set(key, value);
  for (const [key, value] of Object.entries(context.attribution)) if (!target.has(key)) target.set(key, value);
  for (const [key, values] of Object.entries(context.answers)) {
    if (!target.has(`answer.${key}`)) for (const value of values) target.append(`answer.${key}`, value);
  }
}

function bounded(value: string | null, maximum: number) { return value !== null && value.length <= maximum ? value : undefined; }
