import {
  createAgentDoor,
  type Trust,
} from "../../../base/modules/agent-door/index.ts";
import { createBusinessSettings } from "../../../base/modules/business-settings/index.ts";
import type { AppBindings } from "../bindings";
import type { AppServices } from "../services";
import surface from "../../../../agent-surface.json";
import { nativePeople } from "./people";
import { nativeTools } from "./tools";
import { nativeResources } from "./resources";

export const agentPath = (path: string) =>
  path === "/mcp" ||
  path === "/agents" ||
  path.startsWith("/agents/") ||
  path.startsWith("/.well-known/oauth-protected-resource") ||
  path === "/api/rer/agent-policy" ||
  path === "/api/rer/business-settings" ||
  path === "/rer-business-logo" ||
  path === "/rer-business.css";
function trust(env: AppBindings): Trust | null {
  const issuer = env.RER_OWNER_CLAIM_ISSUER,
    installationId = env.RER_OWNER_CLAIM_INSTALLATION_ID,
    appOrigin = env.RER_OWNER_CLAIM_APP_ORIGIN ?? env.APP_URL,
    keys = env.RER_OWNER_CLAIM_PUBLIC_KEYS;
  if (!issuer && !installationId && !keys) return null;
  if (!issuer || !installationId || !keys)
    throw new Error("Incomplete owner-claim trust for the agent door");
  return {
    issuer,
    installationId,
    appOrigin,
    publicKeys: JSON.parse(keys) as Trust["publicKeys"],
  };
}
export async function agentResponse(
  request: Request,
  env: AppBindings,
  services: AppServices,
) {
  const business = createBusinessSettings({
    db: env.DB,
    trust: env.RER_BUSINESS_TRUST,
    business: { settings: 1, values: ["display_name"] },
    team: {
      async ownerEmail() {
        return (
          (
            await env.DB.prepare(
              "SELECT o.email FROM oa_operators o JOIN operator_setup_identity s ON s.operator_id=o.id WHERE s.singleton_key='default' AND o.status='active'",
            ).first<{ email: string }>()
          )?.email ?? null
        );
      },
      // OPER-001 has no native team admission yet. Do not create shadow members or owner privileges.
      async prepare() {
        throw new Error("Dial does not yet admit Business team roles");
      },
    },
  });
  const settings = await business.handle(request);
  if (settings) return settings;
  const displayName = await business.resolve("display_name", "Dial");
  return createAgentDoor({
    seed: "dial",
    name: typeof displayName === "string" ? displayName : "Dial",
    specialist: surface.specialist,
    db: env.DB,
    origin: new URL(env.APP_URL).origin,
    trust: trust(env),
    capabilities: [
      "tools",
      "policy",
      "pause",
      "audit",
      "idempotency",
      "resources",
    ],
    people: nativePeople(env.DB, services),
    tools: nativeTools(env, services),
    resources: nativeResources(services),
    notTools: surface.notTools as Array<{
      clauses: string[];
      reason:
        | "screen"
        | "device"
        | "connector"
        | "import-door"
        | "installation";
    }>,
  }).handle(request);
}
