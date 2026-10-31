import { foldEmail } from "../erasure";
import { ClientRecords } from "./records";

/** Scheduling history is a projection of booking custody, so erasure and archive
 * restore cannot leave behind a second copy of an invitee's personal details.
 * Email equivalence is exactly the booking/erasure fold; plus tags stay distinct.
 */
export class ClientsRepository {
  readonly records: ClientRecords;
  constructor(private readonly db: D1Database) { this.records = new ClientRecords(db); }
  async list(limit: number, offset: number) {
    const identity = "coalesce(c.email,b.invitee_email_folded)";
    const from = "FROM bookings b LEFT JOIN client_aliases a ON a.email=b.invitee_email_folded LEFT JOIN client_profiles c ON c.id=a.client_id";
    // SQLite reads the bare name from the row holding max(created_at): the client's latest booking.
    const rows = await this.db.prepare(`SELECT ${identity} AS email, count(*) AS bookingCount, b.invitee_name AS name, max(b.created_at) AS latest
      ${from} GROUP BY ${identity} ORDER BY lower(name), email LIMIT ? OFFSET ?`)
      .bind(limit, offset).all<{ email: string; bookingCount: number; name: string }>();
    const total = await this.db.prepare(`SELECT count(DISTINCT ${identity}) AS n ${from}`).first<{ n: number }>();
    return { clients: rows.results.map(({ email, bookingCount, name }) => ({ email, name, bookingCount })), totalCount: total?.n ?? 0 };
  }
  async history(email: string, limit: number, offset: number) {
    const folded = foldEmail(email);
    const addresses = JSON.stringify(await this.records.addresses(folded));
    const ids = await this.db.prepare(`SELECT b.id FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id
      WHERE b.invitee_email_folded IN(SELECT value FROM json_each(?)) ORDER BY o.start_at,b.id LIMIT ? OFFSET ?`)
      .bind(addresses, limit, offset).all<{ id: string }>();
    const total = await this.db.prepare("SELECT count(*) AS n FROM bookings WHERE invitee_email_folded IN(SELECT value FROM json_each(?))").bind(addresses).first<{ n: number }>();
    const latest = await this.db.prepare("SELECT invitee_name AS name FROM bookings WHERE invitee_email_folded IN(SELECT value FROM json_each(?)) ORDER BY created_at DESC,id DESC LIMIT 1").bind(addresses).first<{ name: string }>();
    return { email: (await this.records.profile(folded))?.email ?? folded, name: latest?.name ?? "", ids: ids.results.map(row => row.id), totalCount: total?.n ?? 0 };
  }
}
