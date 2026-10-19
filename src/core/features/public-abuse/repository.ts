import { createId, nowIso } from "../../shared/ids";

/** `createdBy.email` is null once the author's operator identity is erased (`OPER-002`). */
export type BlockedAddressRule = { id: string; kind: "email" | "domain"; value: string; createdAt: string; createdBy: { operatorId: string; email: string | null } };
type RuleRow = Omit<BlockedAddressRule, "createdBy"> & { createdByOperatorId: string; createdByEmail: string | null };
export const blockedAddressSql = "EXISTS (SELECT 1 FROM blocked_address_rules WHERE (kind = 'email' AND value = ?) OR (kind = 'domain' AND value = ?))";
export function blockedAddressValues(email: string) { const normalized = email.trim().toLowerCase(); return [normalized, normalized.split("@")[1]]; }

const selectRules = "SELECT r.id, r.kind, r.value, r.created_at AS createdAt, r.created_by_operator_id AS createdByOperatorId, CASE WHEN o.erased_at IS NULL THEN o.email END AS createdByEmail FROM blocked_address_rules r LEFT JOIN operators o ON o.id = r.created_by_operator_id";
const toRule = ({ createdByOperatorId, createdByEmail, ...rule }: RuleRow): BlockedAddressRule => ({ ...rule, createdBy: { operatorId: createdByOperatorId, email: createdByEmail } });

export class PublicAbuseRepository {
  constructor(private readonly binding: D1Database) {}

  async list(): Promise<BlockedAddressRule[]> {
    return (await this.binding.prepare(`${selectRules} ORDER BY r.created_at, r.id`).all<RuleRow>()).results.map(toRule);
  }

  async add(kind: BlockedAddressRule["kind"], value: string, operatorId: string) {
    await this.binding.prepare("INSERT INTO blocked_address_rules (id, kind, value, created_by_operator_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind, value) DO NOTHING").bind(createId(), kind, value, operatorId, nowIso()).run();
    const row = await this.binding.prepare(`${selectRules} WHERE r.kind = ? AND r.value = ?`).bind(kind, value).first<RuleRow>();
    return row ? toRule(row) : null;
  }

  async remove(id: string) {
    return (await this.binding.prepare("DELETE FROM blocked_address_rules WHERE id = ?").bind(id).run()).meta.changes === 1;
  }

  async isBlocked(email: string) {
    return Boolean(await this.binding.prepare(`SELECT 1 WHERE ${blockedAddressSql}`).bind(...blockedAddressValues(email)).first());
  }
}
