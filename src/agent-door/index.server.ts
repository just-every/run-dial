import { createAgentDoor,type AgentDoorOptions } from "../../modules/agent-door/index.ts";
import type { AppBindings } from "../core/app/bindings";
import type { AppServices } from "../core/app/services";
import type { RuntimeEnvironment } from "../core/shared/runtime-env";
import { dialBusinessSettings,dialOwnerTrust } from "./business";
import { dialPeople } from "./people";
import { dialTools } from "./tools";

export const capabilities = ["tools", "policy", "pause", "audit", "idempotency"] as const;
export const specialist = "scheduling coordinator";
export const notTools: NonNullable<AgentDoorOptions["notTools"]> = [
  { clauses: ["CAL-001", "CAL-010", "PAY-001", "PAY-006", "FLOW-005"], reason: "connector" },
  { clauses: ["DATA-003", "MIGRATE-001"], reason: "import-door" },
  { clauses: ["OPER-001", "OPER-002"], reason: "installation" },
  { clauses: ["PROFILE-002", "BRAND-001", "BOOK-011", "AGENT-005"], reason: "screen" },
];

/** One installation door. There is no SDK/device/session credential conversion. */
export function dialAgentDoor(env: AppBindings, runtime: RuntimeEnvironment, services: AppServices) {
  const trust = dialOwnerTrust(runtime);
  const business = dialBusinessSettings({ db: env.DB, trust });
  // The extra field is retained unchanged by 0.2.86. Family scoping needs #670.
  const options = {
    seed: "dial", name: "Dial", specialist, db: env.DB, origin: new URL(runtime.APP_URL).origin,
    trust, capabilities, tools: dialTools(services), resources: [], notTools,
    people: dialPeople({ db: env.DB, session: request => services.operators.auth.getSession(request) }),
    prompts: [{ name: "coordinate", title: "Coordinate scheduling", description: "Use Dial's current native scheduling tools under the sponsor's policy.", clauses: ["AGENT-001"],
      messages: () => [{ role: "user", content: { type: "text", text: "Act as a scheduling coordinator for the sponsoring native owner. Inspect current records, use server-computed classes, preserve native revisions, and obtain named approvals when required. Queued work, mail edges, team administration, subscriptions and resource refresh are undeclared. Never invent a grant, send, charge or delayed effect. MCP supports 2026-07-28 and 2025-11-25." } }],
    }],
  } satisfies AgentDoorOptions & { capabilities: typeof capabilities };
  const door = createAgentDoor(options);
  return { door, async handle(request: Request) { return await business.handle(request) ?? await door.handle(request); } };
}
