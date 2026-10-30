import type { EventDetailsInput } from "../../repository";

type Field = keyof EventDetailsInput;
type Issue = { code: string; path: PropertyKey[]; message: string; minimum?: number | bigint; maximum?: number | bigint; inclusive?: boolean; origin?: string };

/** What each details field is called on screen, and the unit of a number. Nothing here is a schema or field key. */
const names: Partial<Record<Field, { noun: string; unit?: string }>> = {
  slug: { noun: "the address" },
  title: { noun: "the name" },
  description: { noun: "the description" },
  color: { noun: "the colour" },
  durationMinutes: { noun: "the length", unit: "minutes" },
  durationOptionsMinutes: { noun: "the lengths" },
  slotIncrementMinutes: { noun: "the start increment" },
  minimumNoticeMinutes: { noun: "the minimum notice", unit: "minutes" },
  bookingHorizonDays: { noun: "the booking horizon", unit: "days" },
  bookingStartDate: { noun: "the first bookable date" },
  bookingEndDate: { noun: "the last bookable date" },
  beforeBufferMinutes: { noun: "the before buffer", unit: "minutes" },
  afterBufferMinutes: { noun: "the after buffer", unit: "minutes" },
  hostDayBookingLimit: { noun: "the host-day cap" },
  locations: { noun: "the places" },
  questions: { noun: "the questions" },
  postBookingRedirect: { noun: "the page after booking" },
};
const capital = (text: string) => text[0].toUpperCase() + text.slice(1);

/** One plain sentence for an issue the page can check itself: it names the field and never shows the schema's own text. */
export function plainProblem(field: Field, issue: Issue): string {
  const { noun, unit } = names[field] ?? { noun: "this setting" };
  const bound = (value: number | bigint | undefined) => `${value}${unit ? ` ${unit}` : ""}`;
  if (issue.code === "custom") return issue.message;
  if (field === "slug" && issue.code === "invalid_format") return "The address can use lowercase letters, numbers and dashes only.";
  if (issue.code === "too_small" && issue.origin === "string") return Number(issue.minimum) <= 1 ? `Add ${noun}.` : `${capital(noun)} needs at least ${issue.minimum} characters.`;
  if (issue.code === "too_big" && issue.origin === "string") return `${capital(noun)} can be at most ${issue.maximum} characters.`;
  if (issue.code === "too_small" && issue.origin === "number" && issue.inclusive === false) return `${capital(noun)} must be more than ${bound(issue.minimum)}.`;
  if (issue.code === "too_small" && issue.origin === "number") return `${capital(noun)} can be at least ${bound(issue.minimum)}.`;
  if (issue.code === "too_big" && issue.origin === "number") return `${capital(noun)} can be at most ${bound(issue.maximum)}.`;
  return `Check ${noun}.`;
}
