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
    const rows = await this.db.prepare(`WITH ${clientParticipationSql} SELECT ${identity} AS email, count(DISTINCT p.booking_id) AS bookingCount
      ${from} GROUP BY ${identity} ORDER BY email LIMIT ? OFFSET ?`)
      .bind(limit, offset).all<{ email: string; bookingCount: number }>();
    const total = await this.db.prepare(`WITH ${clientParticipationSql} SELECT count(DISTINCT ${identity}) AS n ${from}`).first<{ n: number }>();
    return { clients: rows.results, totalCount: total?.n ?? 0 };
  }
  async history(email: string, limit: number, offset: number) {
    const folded = foldEmail(email);
    const addresses = JSON.stringify(await this.records.addresses(folded));
    const from = `FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id
      WHERE b.id IN(SELECT booking_id FROM client_participation WHERE email IN(SELECT value FROM json_each(?)))`;
    const ids = await this.db.prepare(`WITH ${clientParticipationSql} SELECT b.id ${from} ORDER BY o.start_at,b.id LIMIT ? OFFSET ?`)
      .bind(addresses, limit, offset).all<{ id: string }>();
    const total = await this.db.prepare(`WITH ${clientParticipationSql} SELECT count(*) AS n ${from}`).bind(addresses).first<{ n: number }>();
    return { email: (await this.records.profile(folded))?.email ?? folded, ids: ids.results.map(row => row.id), totalCount: total?.n ?? 0 };
  }
}
