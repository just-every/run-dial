import { formatUsd } from "../../../shared/event-price";

export type AppointmentCredit = {
  id: string;
  name?: string;
  kind: "package" | "membership" | "gift" | "coupon";
  balance: number;
  unit: string;
  state: string;
  expiresAt: string;
  periodEnd?: string | null;
  email?: string;
  history: Array<{ bookingId: string; units: number; discountCents?: number; restoredAt: string | null; createdAt: string }>;
};
export const creditKinds = { package: "Package", membership: "Monthly membership", gift: "Gift certificate", coupon: "Coupon" };
export function creditBalance(credit: Pick<AppointmentCredit, "kind" | "balance">) {
  return credit.kind === "gift" ? formatUsd(credit.balance) : `${credit.balance} ${credit.kind === "coupon" ? credit.balance === 1 ? "use" : "uses" : credit.balance === 1 ? "session" : "sessions"}`;
}
function date(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}
/** The same ledger values are shown in private Settings and the booking's manage capability. */
export function CreditLedger({ credit }: { credit: AppointmentCredit }) {
  return <div className="min-w-0 text-sm leading-6">
    <p><strong>{credit.name ?? creditKinds[credit.kind]} · {creditBalance(credit)} remaining</strong></p>
    <p>{credit.state.replaceAll("_", " ")} · Expires {date(credit.expiresAt)}</p>
    {credit.kind === "membership" && credit.periodEnd ? <p>Current monthly period ends {date(credit.periodEnd)}.</p> : null}
    {credit.history.length ? <ol aria-label="Redemption history" className="mt-3 grid gap-2">{credit.history.map(row => <li key={row.bookingId} className="min-w-0 rounded-lg bg-wash p-3">
      <p>{credit.kind === "gift" ? formatUsd(row.units) : `${row.units} ${credit.kind === "coupon" ? "coupon use" : "session"}`} redeemed {date(row.createdAt)}</p>
      <p>{credit.kind === "coupon" && row.discountCents ? `Discount ${formatUsd(row.discountCents)} · ` : ""}Booking <code className="break-all">{row.bookingId}</code>{row.restoredAt ? ` · Restored ${date(row.restoredAt)}` : ""}</p>
    </li>)}</ol> : <p>No redemptions yet.</p>}
  </div>;
}
