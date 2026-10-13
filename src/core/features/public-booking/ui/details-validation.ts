export type DetailsQuestion = { key: string; label: string; kind: string; required: boolean; options: Array<{ value: string; label: string }> };
export const questionErrorKey = (key: string) => `question:${key}`;
export function detailsErrors(name: string, email: string, questions: DetailsQuestion[], answers: Record<string, string | string[]>) {
  const errors: Record<string, string> = {};
  if (!name.trim()) errors.name = "Enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Enter a valid email address.";
  for (const question of questions) {
    const value = answers[question.key];
    if (question.kind === "multiple_choice" || question.kind === "checkbox") {
      if (question.required && (!Array.isArray(value) || !value.length)) errors[questionErrorKey(question.key)] = `Choose at least one option for ${question.label}.`;
    } else if (question.required && (typeof value !== "string" || !value.trim())) errors[questionErrorKey(question.key)] = `Complete ${question.label}.`;
  }
  return errors;
}
