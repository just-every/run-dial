/** Only the existing native erasure facts are visible here. In particular, do
 * not join subjects or actors back to personal records or select payment facts. */
export type ErasureAuditEntry = {
  id: string;
  actorType: string;
  actorId: string | null;
  happenedAt: string;
  action: "erased";
  subjectKind: "booking" | "availability_request";
};

const projection = "id, actor_type AS actorType, actor_id AS actorId, happened_at AS happenedAt, action, entity_kind AS subjectKind";
const predicate = "action = 'erased' AND entity_kind IN ('booking', 'availability_request')";
const ordering = "happened_at DESC, id DESC";

export class ErasureAuditQuery {
  constructor(private readonly db: D1Database) {}

  async page(limit: number, offset: number) {
    const [count, rows] = await this.db.batch([
      this.db.prepare(`SELECT count(*) AS total FROM anonymized_audit WHERE ${predicate}`),
      this.db.prepare(`SELECT ${projection} FROM anonymized_audit WHERE ${predicate} ORDER BY ${ordering} LIMIT ? OFFSET ?`).bind(limit, offset),
    ]);
    return { total: (count.results[0] as { total: number }).total, entries: rows.results as ErasureAuditEntry[] };
  }

  /** Bounded keyset reads export all matching entries, including past the JSON
   * page limit. The same allowlist and predicate apply to both public doors. */
  async *all(): AsyncGenerator<ErasureAuditEntry> {
    let cursor: ErasureAuditEntry | undefined;
    while (true) {
      const after = cursor ? " AND (happened_at < ? OR (happened_at = ? AND id < ?))" : "";
      const statement = this.db.prepare(`SELECT ${projection} FROM anonymized_audit WHERE ${predicate}${after} ORDER BY ${ordering} LIMIT 500`);
      const rows = (await (cursor ? statement.bind(cursor.happenedAt, cursor.happenedAt, cursor.id) : statement).all<ErasureAuditEntry>()).results;
      for (const row of rows) yield row;
      if (rows.length < 500) return;
      cursor = rows[rows.length - 1];
    }
  }
}
