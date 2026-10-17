import type { PublicEvent } from "./types";

export type Answers = Record<string, string | string[]>;
/** Use only after a refused attempt: accepted-response replay needs its exact original payload. */
export function retainConfiguredAnswers(questions: PublicEvent["questions"], answers: Answers): Answers {
  const entries: Array<[string, string | string[]]> = [];
  for (const question of questions) {
    if (!Object.hasOwn(answers, question.key)) continue;
    const value = answers[question.key], choices = new Set(question.options.map((option) => option.value));
    if ((question.kind === "text" || question.kind === "textarea" || question.kind === "phone") && typeof value === "string") entries.push([question.key, value]);
    else if ((question.kind === "single_choice" || question.kind === "dropdown") && typeof value === "string" && choices.has(value)) entries.push([question.key, value]);
    else if ((question.kind === "multiple_choice" || question.kind === "checkbox") && Array.isArray(value)) entries.push([question.key, [...new Set(value.filter((entry) => choices.has(entry)))]]);
  }
  return Object.fromEntries(entries);
}
