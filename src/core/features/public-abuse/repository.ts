import { createId, nowIso } from "../../shared/ids";

export type BlockedAddressRule = { id: string; kind: "email" | "domain"; value: string; createdAt: string };
export const blockedAddressSql = "EXISTS (SELECT 1 FROM blocked_address_rules WHERE (kind = 'email' AND value = ?) OR (kind = 'domain' AND value = ?))";
export function blockedAddressValues(email: string) { const normalized = email.trim().toLowerCase(); return [normalized, normalized.split("@")[1]]; }

export class PublicAbuseRepository {
  constructor(private readonly binding: D1Database) {}

  async list(): Promise<BlockedAddressRule[]> {
    return (await this.binding.prepare("SELECT id, kind, value, created_at AS createdAt FROM blocked_address_rules ORDER BY created_at, id").all<BlockedAddressRule>()).results;
  }

  async add(kind: BlockedAddressRule["kind"], value: string, operatorId: string) {
    await this.binding.prepare("INSERT INTO blocked_address_rules (id, kind, value, created_by_operator_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind, value) DO NOTHING").bind(createId(), kind, value, operatorId, nowIso()).run();
    return this.binding.prepare("SELECT id, kind, value, created_at AS createdAt FROM blocked_address_rules WHERE kind = ? AND value = ?").bind(kind, value).first<BlockedAddressRule>();
  }

  async remove(id: string) {
    return (await this.binding.prepare("DELETE FROM blocked_address_rules WHERE id = ?").bind(id).run()).meta.changes === 1;
  }

  async isBlocked(email: string) {
    return Boolean(await this.binding.prepare(`SELECT 1 WHERE ${blockedAddressSql}`).bind(...blockedAddressValues(email)).first());
  }
}
