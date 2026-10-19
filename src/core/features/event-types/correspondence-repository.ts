import { correspondenceConfigSchema, defaultCorrespondenceConfig, type CorrespondenceConfig } from "../../shared/correspondence";
import { nextEventTimestampSql } from "../../shared/event-revision";

export class EventCorrespondenceRepository {
  constructor(private readonly binding: D1Database) {}
  async read(eventId: string): Promise<CorrespondenceConfig | null> {
    const row = await this.binding.prepare(`SELECT c.templates_json AS config FROM event_types e LEFT JOIN event_correspondence c ON c.event_type_id=e.id WHERE e.id=?`).bind(eventId).first<{ config: string | null }>();
    return row ? row.config === null ? defaultCorrespondenceConfig() : JSON.parse(row.config) as CorrespondenceConfig : null;
  }
  async save(eventId: string, config: CorrespondenceConfig, now: string) {
    const results = await this.binding.batch([
      this.binding.prepare(`INSERT INTO event_correspondence (event_type_id,templates_json,created_at,updated_at)
        SELECT id,?,?,? FROM event_types WHERE id=?
        ON CONFLICT(event_type_id) DO UPDATE SET templates_json=excluded.templates_json,updated_at=excluded.updated_at`)
        .bind(JSON.stringify(config), now, now, eventId),
      this.binding.prepare(`UPDATE event_types SET updated_at=${nextEventTimestampSql} WHERE id=?`).bind(now, eventId),
    ]);
    return results[0].meta.changes > 0;
  }
  async unknownOperators(ids: readonly string[]) {
    if (!ids.length) return [];
    const rows = await this.binding.prepare(`SELECT id FROM operators WHERE removed_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string }>();
    const current = new Set(rows.results.map(row => row.id));
    return ids.filter(id => !current.has(id));
  }
  validateQuestions(candidate: unknown, questions: { key?: string; label: string; private?: boolean }[]) {
    return correspondenceConfigSchema(questions.flatMap(question => question.key ? [{ ...question, key: question.key }] : [])).safeParse(candidate);
  }
  async parse(eventId: string, candidate: unknown) {
    const rows = await this.binding.prepare(`SELECT COALESCE(public_key,'q_'||id) AS key,label,private FROM event_questions WHERE event_type_id=? ORDER BY position`).bind(eventId).all<{ key: string; label: string; private: number }>();
    return correspondenceConfigSchema(rows.results.map(row => ({ ...row, private: row.private === 1 }))).safeParse(candidate);
  }
}
