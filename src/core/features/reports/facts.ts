export type BookingFact = {
  id: string; state: "confirmed" | "rescheduled" | "cancelled"; imported: boolean;
  createdAt: string; firstStartAt: string; startAt: string; endAt: string;
  attribution: Record<string, string>;
  cancelledAt: string | null; cancelledReason: string | null;
  rescheduledAt: string[]; attendance: "attended" | "no_show" | null;
  paidAt: string | null; paidCents: number;
};

type Row = Omit<BookingFact, "attribution" | "rescheduledAt" | "imported"> & { imported: number; attributionJson: string; rescheduledJson: string };

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
        a.status AS attendance, p.paid_at AS paidAt, COALESCE(p.amount_cents, 0) AS paidCents
      FROM bookings b JOIN booking_occurrences o ON o.id = b.current_occurrence_id
      LEFT JOIN booking_attendance a ON a.booking_id = b.id
      LEFT JOIN booking_payments p ON p.booking_id = b.id
      WHERE (?3 IS NULL OR b.event_type_id = ?3)
        AND ((b.created_at BETWEEN ?1 AND ?2) OR (o.start_at BETWEEN ?1 AND ?2) OR (b.cancelled_at BETWEEN ?1 AND ?2) OR (p.paid_at BETWEEN ?1 AND ?2)
          OR EXISTS (SELECT 1 FROM booking_occurrences f WHERE f.booking_id = b.id AND f.sequence = 0 AND f.start_at BETWEEN ?1 AND ?2)
          OR EXISTS (SELECT 1 FROM booking_history h WHERE h.booking_id = b.id AND h.action = 'rescheduled' AND h.created_at BETWEEN ?1 AND ?2))
      ORDER BY b.created_at, b.id`).bind(from, to, eventTypeId ?? null).all<Row>();
    return result.results.map(({ attributionJson, rescheduledJson, imported, ...row }) => ({ ...row, imported: imported === 1, attribution: JSON.parse(attributionJson) as Record<string, string>, rescheduledAt: JSON.parse(rescheduledJson) as string[] }));
  }
}
