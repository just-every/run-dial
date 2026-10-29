import type {
  PeopleAdapter,
  Person,
} from "../../../base/modules/agent-door/index.ts";
import type { AppServices } from "../services";

/** Dial's production private services currently admit equal owners only (OPER-001). */
export function nativePeople(
  db: D1Database,
  services: AppServices,
): PeopleAdapter {
  const read = async (id: string): Promise<Person | null> => {
    const row = await db
      .prepare(
        `SELECT a.id,a.email,a.display_name AS name,a.role,a.status
      FROM oa_operators a LEFT JOIN operators p ON p.id=a.id WHERE a.id=?
      AND (p.erased_at IS NULL)`,
      )
      .bind(id)
      .first<Person & { status: string }>();
    return row
      ? {
          id: row.id,
          email: row.email,
          name: row.name,
          role: row.role,
          active: row.status === "active" && row.role === "owner",
        }
      : null;
  };
  // Setup fixes the original native owner. Never move the binding by an email lookup.
  const owner = () =>
    db
      .prepare(
        `SELECT operator_id AS id FROM operator_setup_identity WHERE singleton_key='default'`,
      )
      .first<{ id: string }>();
  return {
    person: read,
    async sponsor({ sub }) {
      const settings = await db
        .prepare(
          "SELECT owner_id FROM bs_settings WHERE singleton=1 AND stopped=0",
        )
        .first<{ owner_id: string }>();
      if (settings?.owner_id === sub) {
        const original = await owner();
        return original ? read(original.id) : null;
      }
      const row = await db
        .prepare(
          "SELECT operator_id FROM bs_team WHERE business_id=? AND state='active'",
        )
        .bind(sub)
        .first<{ operator_id: string }>();
      return row ? read(row.operator_id) : null;
    },
    async businessMember(person) {
      const settings = await db
        .prepare(
          "SELECT owner_id FROM bs_settings WHERE singleton=1 AND stopped=0",
        )
        .first<{ owner_id: string }>();
      if (settings?.owner_id && (await owner())?.id === person.id)
        return { id: settings.owner_id, role: "owner" };
      const row = await db
        .prepare(
          "SELECT business_id,business_role FROM bs_team WHERE operator_id=? AND state='active'",
        )
        .bind(person.id)
        .first<{ business_id: string; business_role: string }>();
      return row?.business_id
        ? {
            id: row.business_id,
            role: row.business_role === "admin" ? "editor" : null,
          }
        : null;
    },
    async session(request) {
      const session = await services.operators.auth.getSession(request);
      return session ? read(session.operator.id) : null;
    },
  };
}
