import { formatUsd } from "../../../shared/event-price";

export type AppointmentProduct = { id: string; kind: "package" | "membership" | "gift"; name: string; sessions: number; amountCents: number; validityDays: number; sold?: number };
export type AppointmentCredit = { id: string; kind: AppointmentProduct["kind"] | "coupon"; name?: string; eventTypeId?: string; balance: number; unit: string; state: string; expiresAt: string; periodEnd?: string | null; history?: Array<{ bookingId: string; units: number; createdAt: string; discountCents?: number; restoredAt: string | null }> };
export const creditLabel = (kind: AppointmentCredit["kind"]) => ({ package: "Package", membership: "Membership", gift: "Gift certificate", coupon: "Coupon" })[kind];
export const creditAmount = (credit: Pick<AppointmentCredit, "kind" | "unit">, units: number) => credit.unit === "USD cents" ? formatUsd(units) : `${units} ${credit.kind === "coupon" ? units === 1 ? "use" : "uses" : units === 1 ? "session" : "sessions"}`;
const date = (value: string, timezone: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));

/** The host and the private manage capability show the same recorded credit ledger. */
export function EntitlementSummary({ credit, timezone = "UTC", host = false }: { credit: AppointmentCredit; timezone?: string; host?: boolean }) {
  return <section className={host ? "min-w-0 text-sm leading-6" : "pb-payment-summary"} aria-label="Appointment credit">
    <h2 className={host ? "font-semibold" : undefined}>{credit.name ?? creditLabel(credit.kind)}</h2>
    <p><strong>Remaining balance: {creditAmount(credit, credit.balance)}</strong> · {credit.state.replaceAll("_", " ")}</p>
    <p>Expires {date(credit.expiresAt, timezone)} ({timezone})</p>
    {credit.kind === "membership" && credit.periodEnd ? <p>Current membership period ends {date(credit.periodEnd, timezone)}. A paid renewal resets your sessions.</p> : null}
    {credit.history ? <details className="mt-3"><summary className="cursor-pointer font-semibold">Redemption history ({credit.history.length})</summary>{credit.history.length ? <ol className="mt-2 grid gap-2" aria-label="Credit redemptions">{credit.history.map(entry => <li className="min-w-0 rounded-xl bg-row p-3" key={entry.bookingId}><p>{creditAmount(credit, entry.units)} redeemed · {date(entry.createdAt, timezone)}</p>{credit.kind === "coupon" && entry.discountCents !== undefined ? <p>Booking discount: {formatUsd(entry.discountCents)}</p> : null}<p>{entry.restoredAt ? `Restored ${date(entry.restoredAt, timezone)}` : "Used for a booking"}</p>{host ? <a className="break-all underline" href={`/app/bookings/${encodeURIComponent(entry.bookingId)}`}>Open booking</a> : null}</li>)}</ol> : <p>No redemptions yet.</p>}</details> : null}
  </section>;
}
