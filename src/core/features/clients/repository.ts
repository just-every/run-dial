import { foldEmail } from "../erasure";

/** Scheduling history is a projection of booking custody, so erasure and archive
 * restore cannot leave behind a second copy of an invitee's personal details.
 * Email equivalence is exactly the booking/erasure fold; plus tags stay distinct.
 */
export class ClientsRepository {
  constructor(private readonly db: D1Database) {}
  async list(limit: number, offset: number) {
    const rows = await this.db.prepare(`SELECT invitee_email_folded AS email, count(*) AS bookingCount
      FROM bookings GROUP BY invitee_email_folded ORDER BY invitee_email_folded LIMIT ? OFFSET ?`)
      .bind(limit, offset).all<{ email: string; bookingCount: number }>();
    const total = await this.db.prepare("SELECT count(DISTINCT invitee_email_folded) AS n FROM bookings").first<{ n: number }>();
    return { clients: rows.results, totalCount: total?.n ?? 0 };
  }
  async history(email: string, limit: number, offset: number) {
    const folded = foldEmail(email);
    const ids = await this.db.prepare(`SELECT b.id FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id
      WHERE b.invitee_email_folded=? ORDER BY o.start_at,b.id LIMIT ? OFFSET ?`)
      .bind(folded, limit, offset).all<{ id: string }>();
    const total = await this.db.prepare("SELECT count(*) AS n FROM bookings WHERE invitee_email_folded=?").bind(folded).first<{ n: number }>();
    return { email: folded, ids: ids.results.map(row => row.id), totalCount: total?.n ?? 0 };
  }
}
