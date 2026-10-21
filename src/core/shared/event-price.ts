/** PAY-001 prices shared by the Worker and the browser: USD cents, an event price and per-duration prices. */
export type EventPrice = { amountCents: number | null; durationPrices: Array<{ durationMinutes: number; amountCents: number }>; currency: "usd" };

/** The chosen duration's own price applies; otherwise the event's price. Undefined means a free booking. */
export function priceForDuration(price: EventPrice, durationMinutes: number) {
  return price.durationPrices.find(entry => entry.durationMinutes === durationMinutes)?.amountCents ?? price.amountCents ?? undefined;
}

export function isPaid(price: EventPrice) { return price.amountCents !== null || price.durationPrices.length > 0; }

export function formatUsd(amountCents: number) {
  return `$${(amountCents / 100).toFixed(2)} USD`;
}
