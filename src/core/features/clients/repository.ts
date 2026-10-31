import { foldEmail } from "../erasure";
import { ClientRecords } from "./records";
import { clientParticipationSql } from "./participation";

/** Scheduling history is a projection of booking custody, so erasure and archive
 * restore cannot leave behind a second copy of an invitee's personal details.
 * Email equivalence is exactly the booking and erasure fold; plus tags stay distinct.
 */
export class ClientsRepository {
  readonly records: ClientRecords;
  constructor(private readonly db: D1Database) { this.records = new ClientRecords(db); }
  async list(limit: number, offset: number) {
    const identity = "coalesce(c.email,p.email)";
    const from = "FROM client_participation p LEFT JOIN client_aliases a ON a.email=p.email LEFT JOIN client_profiles c ON c.id=a.client_id";
    // Keep the latest primary booking's name; guest participation supplies no name.
    // SQLite reads the bare name from the row holding max(created_at), as before.
    const names = `client_names AS (SELECT coalesce(c.email,b.invitee_email_folded) AS email, b.invitee_name AS primary_name, max(b.created_at) AS latest
      FROM bookings b LEFT JOIN client_aliases a ON a.email=b.invitee_email_folded LEFT JOIN client_profiles c ON c.id=a.client_id
      GROUP BY coalesce(c.email,b.invitee_email_folded))`;
    const rows = await this.db.prepare(`WITH ${clientParticipationSql}, ${names}
      SELECT ${identity} AS email, count(DISTINCT p.booking_id) AS bookingCount, coalesce(n.primary_name,${identity}) AS name
      ${from} LEFT JOIN client_names n ON n.email=${identity} GROUP BY ${identity} ORDER BY lower(name), email LIMIT ? OFFSET ?`)
      .bind(limit, offset).all<{ email: string; bookingCount: number; name: string }>();
    const total = await this.db.prepare(`WITH ${clientParticipationSql} SELECT count(DISTINCT ${identity}) AS n ${from}`).first<{ n: number }>();
    return { clients: rows.results.map(({ email, bookingCount, name }) => ({ email, name, bookingCount })), totalCount: total?.n ?? 0 };
  }
  async history(email: string, limit: number, offset: number) {
    const folded = foldEmail(email);
    const addresses = JSON.stringify(await this.records.addresses(folded));
    const from = `FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id
      WHERE b.id IN(SELECT booking_id FROM client_participation WHERE email IN(SELECT value FROM json_each(?)))`;
    const ids = await this.db.prepare(`WITH ${clientParticipationSql} SELECT b.id ${from} ORDER BY o.start_at,b.id LIMIT ? OFFSET ?`)
      .bind(addresses, limit, offset).all<{ id: string }>();
    const total = await this.db.prepare(`WITH ${clientParticipationSql} SELECT count(*) AS n ${from}`).bind(addresses).first<{ n: number }>();
    const latest = await this.db.prepare("SELECT invitee_name AS name FROM bookings WHERE invitee_email_folded IN(SELECT value FROM json_each(?)) ORDER BY created_at DESC,id DESC LIMIT 1").bind(addresses).first<{ name: string }>();
    const clientEmail = (await this.records.profile(folded))?.email ?? folded;
    return { email: clientEmail, name: latest?.name ?? (total?.n ? clientEmail : ""), ids: ids.results.map(row => row.id), totalCount: total?.n ?? 0 };
  }
}
