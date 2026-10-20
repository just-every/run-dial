import { z } from "zod";
import type { EventPrice } from "../../shared/event-price";
export { formatUsd, isPaid, priceForDuration, type EventPrice } from "../../shared/event-price";

export type PriceRow = { durationMinutes: number; amountCents: number };

const cents = z.number().int().min(50).max(99_999_999);
export const eventPriceInputSchema = z.object({
  amountCents: cents.nullable(),
  durationPrices: z.array(z.object({ durationMinutes: z.number().int().min(5).max(480), amountCents: cents })).max(4),
}).strict();
export type EventPriceInput = z.infer<typeof eventPriceInputSchema>;

export function eventPrice(rows: PriceRow[]): EventPrice {
  return {
    amountCents: rows.find(row => row.durationMinutes === 0)?.amountCents ?? null,
    durationPrices: rows.filter(row => row.durationMinutes !== 0).sort((a, b) => a.durationMinutes - b.durationMinutes),
    currency: "usd",
  };
}


/** Every priced duration must be one the event offers, and a per-duration price covers every offered option
 * unless an event price applies to the rest. */
export function validatePrice(input: EventPriceInput, offeredDurations: number[]) {
  const durations = input.durationPrices.map(entry => entry.durationMinutes);
  if (new Set(durations).size !== durations.length || durations.some(duration => !offeredDurations.includes(duration))) return false;
  return input.amountCents !== null || durations.length === 0 || offeredDurations.every(duration => durations.includes(duration));
}

