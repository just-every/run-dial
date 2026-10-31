import type { PeopleAdapter, Person } from "../../modules/agent-door/types.ts";

interface NativeOperator {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
}
interface Options {
  db: D1Database;
  allowList?: string[];
  session(request: Request): Promise<{ operator: { id: string } } | null>;
}

/** Native IDs are authority. A Business email never selects a sponsor. */
export function dialPeople({ db, session, allowList }: Options): PeopleAdapter {
  const operator = (id: string) => db.prepare(
    "SELECT id,email,display_name AS name,role,status FROM oa_operators WHERE id=?",
  ).bind(id).first<NativeOperator>();
  const allowed = (value: NativeOperator) => value.status === "active" &&
    (allowList === undefined || allowList.includes(value.email));
  // Dial's current operator product admits owners only. A Business role cannot
  // turn an admin/member into an equal-owner operator.
  const nativePerson = async (id: string): Promise<Person | null> => {
    const value = await operator(id);
    if (!value || !allowed(value) || value.role !== "owner") return null;
    return { id: value.id, email: value.email, name: value.name, role: value.role, active: true };
  };
  const setupOwner = () => db.prepare(
    "SELECT operator_id AS id FROM operator_setup_identity WHERE singleton_key='default'",
  ).first<{ id: string }>();
  const ownerBinding = () => db.prepare(
    "SELECT owner_id FROM bs_settings WHERE singleton=1 AND stopped=0",
  ).first<{ owner_id: string | null }>();
  return {
    person: nativePerson,
    async sponsor({ sub }) {
      const binding = await ownerBinding();
      if (!binding) return null;
      if (binding.owner_id === sub) {
        const owner = await setupOwner();
        return owner ? nativePerson(owner.id) : null;
      }
      const row = await db.prepare(
        "SELECT operator_id FROM bs_team WHERE business_id=? AND state IN('active','invited')",
      ).bind(sub).first<{ operator_id: string | null }>();
      return row?.operator_id ? nativePerson(row.operator_id) : null;
    },
    async businessMember(person) {
      const value = await operator(person.id);
      if (!value || !allowed(value)) return null;
      const binding = await ownerBinding();
      if (!binding) return null;
      if (binding.owner_id && (await setupOwner())?.id === value.id && value.role === "owner") {
        return { id: binding.owner_id, role: "owner" };
      }
      const row = await db.prepare(
        "SELECT business_id,business_role FROM bs_team WHERE operator_id=? AND business_id IS NOT NULL AND state IN('active','invited')",
      ).bind(value.id).first<{ business_id: string; business_role: string }>();
      return row ? { id: row.business_id, role: row.business_role === "admin" ? "editor" : null } : null;
    },
    async session(request) {
      const current = await session(request);
      return current ? nativePerson(current.operator.id) : null;
    },
  };
}
