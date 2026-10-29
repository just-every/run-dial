import { readFile, writeFile } from "node:fs/promises";
const surface = JSON.parse(await readFile("agent-surface.json", "utf8"));
const lines = [
  "# Agents in Dial",
  "",
  "Dial offers a scheduling configuration door at `/mcp`. Discover it with MCP 2026-07-28 or 2025-11-25 and use the scopes below. Business must first bind its owner ID to Dial’s original native setup owner and deliver a signed company policy. Token email never selects a native account.",
  "",
  "The current native private service admits active owners. Team admins, members, unknown subjects and inactive people receive no authority through this door. Business team roles are not yet admitted by Dial. Existing API credentials retain their native REST purpose and are not accepted as MCP credentials.",
  "",
  "Open `/agents` with a native person session to inspect policy, Pause, approvals, reviews and audit. Agent authorization cannot approve its own action. Approval binds the exact server summary and revision. Native changes retain the agent, sponsor and real approvers; the activity witness uses the same operation ID.",
  "",
  "## Supported jobs",
  "",
  "| Tool | Scope | Computed classes | Clauses |",
  "| --- | --- | --- | --- |",
  ...surface.tools.map(
    (tool) =>
      `| \`${tool.name}\` | \`${tool.scope}\` | ${tool.classes.join(", ")} | ${tool.clauses.join(", ")} |`,
  ),
  "",
  "Draft configuration is standard; a change affecting published availability or the public host profile is live. Permanent event deletion is destructive. Classes come from native records and effects. Additional caller fields and imported text grant no authority.",
  "",
  "## Record read-back",
  "",
  ...surface.resources.map((uri) => `- \`${uri}\``),
  "",
  "Record-writing results link to the current record. Resource reads use the same current native owner, scope, company policy, approval and audit path. Missing and restricted records both return resource_unavailable. Record text is untrusted. No provider secret, API bearer or session is returned.",
  "",
  "## Current limits",
  "",
  "The declared door has tools, policy, Pause, audit, idempotency and native resources. Events, prompts and subscriptions return capability_not_declared. Multi-sponsor journeys, resource refresh, timed and queued work, mail dispatch, payment movement, booking lifecycle, invitations, client erasure, connectors and owner-native administration have not been adopted into this registry. Those existing native screens and services retain their own supported doors; no MCP parity is claimed for them. Specialist negotiation, follow-up, drift repair, recovery and voice jobs remain target work.",
  "",
  "No tool declares provider cost. Spend caps are not enforced; this journey uses spend:{none:true}. Request capacity is 600 authenticated requests per minute with a 1 MiB body limit. These protect the installation and are not business-volume allowances. There is no generic Undo: this registry offers no native reversal. Reuse a write’s idempotency key with identical arguments; changed arguments conflict. Supply expected_revision from the current native updatedAt value for a versioned edit.",
  "",
  "## Refusals",
  "",
  "Policy unset, unanswered, expired, blocked or Pause produces no native effect. Invalid signatures, token audience, consent or sponsor binding refuse admission. A stale native version returns revision_conflict. Resources return machine codes in JSON-RPC error.data.code; tool refusals use _meta[com.runeditrun/error]. Recognizable failed Business credentials never fall through to local credentials.",
  "",
  "The additive Business and door tables hold installation-local authority and retained decisions. They are excluded from archives; restore never carries pending approval or replay authority. Client-custody erasure of retained agent data remains undeclared and must be resolved before client-writing tools ship.",
  "",
  "The conformance journey is declared in agent-surface.json and runs against a disposable production build and its real migrations. Its only replacement is SendGrid’s paid network edge, including verified-sender readiness. No provider request leaves the verifier.",
];
lines.push("", "The owner bootstrap uses signed `/auth/owner-claim` admission in managed installs, as declared in `rer-setup.json`. Unlinked local installations retain their native setup-token bootstrap. Neither MCP nor a company policy can create an owner or complete installation setup.");
await writeFile("docs/AGENTS.md", lines.join("\n") + "\n");
