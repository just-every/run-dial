export type BookingFact = {
  id: string; state: "confirmed" | "rescheduled" | "cancelled"; imported: boolean;
  createdAt: string; firstStartAt: string; startAt: string; endAt: string;
  attribution: Record<string, string>;
  cancelledAt: string | null; cancelledReason: string | null;
  rescheduledAt: string[]; attendance: "attended" | "no_show" | null;
  /** Money Stripe confirmed for the booking (PAY-001 first payment, PAY-003 movements), each at its settled time. */
  money: Array<{ kind: "payment" | "balance" | "fee" | "refund"; amountCents: number; at: string }>;
};

type Row = Omit<BookingFact, "attribution" | "rescheduledAt" | "imported" | "money"> & { imported: number; attributionJson: string; rescheduledJson: string; moneyJson: string; paidAt: string | null; paidCents: number | null };
const movementKind: Record<string, BookingFact["money"][number]["kind"]> = { balance: "balance", refund: "refund", late_cancel_fee: "fee", no_show_fee: "fee" };

/** One narrow row per booking that the period can touch: created, started, first scheduled, cancelled,
 * rescheduled or paid inside it. The report computes every tile from these rows. */
export class ReportFactsRepository {
  constructor(private readonly db: D1Database) {}

  async facts(range: { from: string; to: string }, eventTypeId?: string): Promise<BookingFact[]> {
    const { from, to } = range;
    const result = await this.db.prepare(`SELECT b.id, b.state, b.imported, b.created_at AS createdAt, b.attribution_json AS attributionJson, b.cancelled_at AS cancelledAt, b.cancelled_reason AS cancelledReason,
        o.start_at AS startAt, o.end_at AS endAt,
        COALESCE((SELECT f.start_at FROM booking_occurrences f WHERE f.booking_id = b.id AND f.sequence = 0), o.start_at) AS firstStartAt,
        (SELECT json_group_array(h.created_at) FROM booking_history h WHERE h.booking_id = b.id AND h.action = 'rescheduled') AS rescheduledJson,
        a.status AS attendance, p.paid_at AS paidAt, p.amount_cents AS paidCents,
        (SELECT json_group_array(json_object('kind', m.kind, 'amountCents', m.amount_cents, 'at', m.updated_at)) FROM payment_movements m WHERE m.booking_id = b.id AND m.status = 'succeeded') AS moneyJson
      FROM bookings b JOIN booking_occurrences o ON o.id = b.current_occurrence_id
      LEFT JOIN booking_attendance a ON a.booking_id = b.id
      LEFT JOIN booking_payments p ON p.booking_id = b.id
      WHERE (?3 IS NULL OR b.event_type_id = ?3)
        AND ((b.created_at BETWEEN ?1 AND ?2) OR (o.start_at BETWEEN ?1 AND ?2) OR (b.cancelled_at BETWEEN ?1 AND ?2) OR (p.paid_at BETWEEN ?1 AND ?2)
          OR EXISTS (SELECT 1 FROM booking_occurrences f WHERE f.booking_id = b.id AND f.sequence = 0 AND f.start_at BETWEEN ?1 AND ?2)
          OR EXISTS (SELECT 1 FROM booking_history h WHERE h.booking_id = b.id AND h.action = 'rescheduled' AND h.created_at BETWEEN ?1 AND ?2)
          OR EXISTS (SELECT 1 FROM payment_movements m WHERE m.booking_id = b.id AND m.status = 'succeeded' AND m.updated_at BETWEEN ?1 AND ?2))
      ORDER BY b.created_at, b.id`).bind(from, to, eventTypeId ?? null).all<Row>();
    return result.results.map(({ attributionJson, rescheduledJson, moneyJson, imported, paidAt, paidCents, ...row }) => ({ ...row, imported: imported === 1, attribution: JSON.parse(attributionJson) as Record<string, string>, rescheduledAt: JSON.parse(rescheduledJson) as string[],
      money: [...(paidAt && paidCents ? [{ kind: "payment" as const, amountCents: paidCents, at: paidAt }] : []), ...(JSON.parse(moneyJson) as Array<{ kind: string; amountCents: number; at: string }>).map(entry => ({ kind: movementKind[entry.kind], amountCents: entry.amountCents, at: entry.at }))] }));
  }
}
