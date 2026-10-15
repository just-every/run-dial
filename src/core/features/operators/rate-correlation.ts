// @ts-expect-error Base's portable grant helper has no TypeScript declaration.
import { ownerSigninDigest } from "../../../../modules/operator-auth/owner-signin-grant.mjs";
import { rateCorrelation } from "../../../modules/erasure/index.mjs";

// DATA-002 with Base's attributable-counter hook: a sign-in counter whose key
// names a known operator (their email, or a link issued to them) is written with
// a rer_erasure_rates correlation, so erasing that operator deletes the counter.
// Keys that name nobody (client IPs, unknown addresses) stay aggregates.
export const operatorRateRoot = { table: "oa_operators", column: "id" } as const;

export function operatorRateCorrelation(db: D1Database) {
  return async ({ scope, key, value, linkHash }: { scope: string; key: string; value: string; linkHash?: string }) => {
    const subject = scope === "confirmation"
      ? await confirmationOperator(db, value, linkHash)
      : await db.prepare("SELECT id FROM oa_operators WHERE email=?").bind(value).first<{ id: string }>();
    if (!subject) return null;
    return {
      statements: rateCorrelation(db, { entity: "operator", root: operatorRateRoot, subject: subject.id, rateTable: "oa_limits", rateKey: key }),
      gone: async () => !await db.prepare("SELECT 1 FROM oa_operators WHERE id=?").bind(subject.id).first(),
    };
  };
}

async function confirmationOperator(db: D1Database, value: string, linkHash?: string) {
  const prefix = "owner-signin:";
  if (value.startsWith(prefix)) {
    const token = value.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return db.prepare("SELECT operator_id AS id FROM oa_owner_signins WHERE token_hash=?").bind(await ownerSigninDigest(token)).first<{ id: string }>();
  }
  return linkHash ? db.prepare("SELECT operator_id AS id FROM oa_tokens WHERE token_hash=?").bind(linkHash).first<{ id: string }>() : null;
}
