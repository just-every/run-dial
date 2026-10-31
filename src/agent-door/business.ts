import type { Trust } from "../../modules/agent-door/types.ts";
import { createBusinessSettings } from "../../modules/business-settings/index.ts";
import { SettingsError,type BusinessManifest,type ManagedMember,type TeamAdapter } from "../../modules/business-settings/types.ts";
import type { RuntimeEnvironment } from "../core/shared/runtime-env";

export const dialBusinessManifest: BusinessManifest = {
  settings: 1,
  values: ["display_name"],
  team: { roles: { admin: "admin", member: "member" } },
};

/** The owner claim and agent door use one installation-owned public key ring. */
export function dialOwnerTrust(runtime: RuntimeEnvironment): Trust | null {
  const { RER_OWNER_CLAIM_ISSUER: issuer, RER_OWNER_CLAIM_INSTALLATION_ID: installationId,
    RER_OWNER_CLAIM_PUBLIC_KEYS: keys, RER_OWNER_CLAIM_APP_ORIGIN: configuredOrigin } = runtime;
  if (![issuer, installationId, keys, configuredOrigin].some(value => value !== undefined)) return null;
  const origin = new URL(runtime.APP_URL).origin;
  const appOrigin = configuredOrigin ?? (runtime.RER_DEMO === "1" ? origin : undefined);
  if (!issuer || !installationId || !keys || appOrigin !== origin) throw new SettingsError("invalid_owner_claim_trust", 503);
  return { issuer, installationId, appOrigin, publicKeys: JSON.parse(keys) as Record<string, JsonWebKey> };
}

/**
 * Dial currently supports equal-owner operator invitations only. A signed team
 * roster must never silently turn an admin or member into a native owner. Keep
 * unsupported bindings visible as conflicts until their native lifecycle exists.
 */
function nativeTeam(db: D1Database, allowList?: string[]): TeamAdapter {
  type Owner = { id: string; email: string; version: number };
  const owner = () => db.prepare(`SELECT o.id,o.email,o.version FROM operator_setup_identity s
    JOIN oa_operators o ON o.id=s.operator_id WHERE s.singleton_key='default'
    AND o.role='owner' AND o.status='active'`).first<Owner>();
  const allowed = (email: string) => allowList === undefined || allowList.includes(email);
  return {
    async ownerEmail() {
      const current = await owner();
      return current && allowed(current.email) ? current.email : null;
    },
    async prepare({ members, managed, ownerEmail, guard }) {
      const current = await owner();
      if (!current || !allowed(current.email) || current.email !== ownerEmail) throw new SettingsError("owner_required");
      const rows = new Map<string, ManagedMember>(managed.map(row => [row.email, { ...row, state: "inactive" }]));
      for (const member of members) {
        const previous = rows.get(member.email);
        rows.set(member.email, { email: member.email, operatorId: previous?.operatorId ?? null,
          invite: member.invite, state: "conflict" });
      }
      // The module's CAS and this live native-owner witness share one batch.
      // A changed setup owner or account version rolls back the signed settings.
      const statements = [db.prepare(`INSERT INTO bs_assert(value)
        SELECT NULL WHERE NOT ((${guard.sql}) AND EXISTS(
          SELECT 1 FROM operator_setup_identity s JOIN oa_operators o ON o.id=s.operator_id
          WHERE s.singleton_key='default' AND o.id=? AND o.email=? AND o.version=?
          AND o.role='owner' AND o.status='active'))`)
        .bind(...guard.args, current.id, current.email, current.version)];
      return { statements, rows: [...rows.values()], async afterCommit() {} };
    },
  };
}

export function dialBusinessSettings(options: {
  db: D1Database;
  trust: Trust | null;
  allowList?: string[];
}) {
  const { db, trust, allowList } = options;
  return createBusinessSettings({
    db,
    business: dialBusinessManifest,
    trust: trust ? { v: 1, issuer: trust.issuer, audience: trust.appOrigin,
      subject: trust.installationId, keys: trust.publicKeys } : null,
    team: nativeTeam(db, allowList),
  });
}
