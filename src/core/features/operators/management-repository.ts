import { eraseRemovedOperator, hasPersonalRecords, requireErasureSession } from "../erasure";
import { AuthError } from "../../../../modules/operator-auth/index.mjs";
import { nowIso } from "../../shared/ids";
import { revokeOperatorMail } from "../delivery";
import type { OperatorsService } from "./service";

export type ManagedOperator = { id: string; email: string; setupOperator: boolean };
/** Settings integration; Base owns every access decision and mutation. */
export class OperatorManagementRepository {
  constructor(private readonly binding: D1Database, private readonly operators: OperatorsService, private readonly secret: string) {}

  async list(request: Request) {
    const entries = await this.operators.auth.listOperators(request);
    const setup = await this.binding.prepare("SELECT operator_id FROM operator_setup_identity WHERE singleton_key='default'").first<{ operator_id: string }>();
    if (!setup) return undefined;
    const erased = new Set((await this.binding.prepare("SELECT id FROM operators WHERE erased_at IS NOT NULL").all<{id:string}>()).results.map(row => row.id));
    return entries.filter(entry => !erased.has(entry.id)).map((entry) => ({ id: entry.id, email: entry.email, setupOperator: entry.id === setup.operator_id, status: entry.status,role:entry.role }));
  }

  async invite(request: Request, email: string, role:"owner"|"admin"="owner") {
    const actor = await this.operators.requireMutation(request);
    const setup = await this.binding.prepare("SELECT operator_id FROM operator_setup_identity WHERE singleton_key='default'").first();
    if (!setup) throw new AuthError("operator_setup_missing", 503);
    const entries = await this.operators.auth.listOperators(request);
    const existing = entries.find((entry) => entry.email === email);
    let invitation: "queued" | "not_deliverable" = "queued";
    try {
      if (existing?.status === "inactive") {
        // Retire work left by a pre-adoption/direct administrative removal before
        // a new invitation or reactivation makes this email eligible again.
        await revokeOperatorMail(this.binding, { email, actorId: actor.operator.id }, nowIso()).run();
        const cancelled = await this.binding.prepare("SELECT 1 FROM oa_invitation_cancellations WHERE operator_id=?").bind(existing.id).first();
        if (cancelled) {
          await this.operators.auth.invite(request, { email, displayName: email, role, returnTo: "/setup" });
        } else {
          await this.operators.auth.setOperatorStatus(request, existing.id, "active");
          await this.operators.auth.requestMagicLink(request, { email, returnTo: "/setup" });
        }
      } else if (existing?.status === "active") {
        await this.operators.auth.requestMagicLink(request, { email, returnTo: "/setup" });
      } else {
        await this.operators.auth.invite(request, { email, displayName: email, role, returnTo: "/setup" });
      }
    } catch (error) {
      if (!(error instanceof AuthError) || error.code !== "mail_unavailable") throw error;
      invitation = "not_deliverable";
    }
    const operator = (await this.operators.auth.listOperators(request)).find((entry) => entry.email === email);
    if (!operator) throw new AuthError("authority_changed", 409);
    return { operator: { id: operator.id, email: operator.email }, invitation };
  }

  /** Called only by the notification singleton, with the original client request. */
  async removeWithinNotificationGate(request: Request, targetId: string) {
    const actor = await this.operators.requireMutation(request);
    await requireErasureSession(this.binding,{id:actor.operator.id,sessionId:actor.id});
    const target = (await this.operators.auth.listOperators(request)).find((entry) => entry.id === targetId);
    if (!target || await this.binding.prepare("SELECT 1 FROM operators WHERE id=? AND erased_at IS NOT NULL").bind(targetId).first()) return true;
    if (targetId === actor.operator.id) throw new AuthError("self_erasure", 409);
    if (await this.binding.prepare("SELECT 1 FROM operator_setup_identity WHERE operator_id=?").bind(targetId).first()) throw new AuthError("setup_operator_erasure_hold", 409);
    if (await hasPersonalRecords(this.binding,target.email)) throw new AuthError("operator_identity_overlap", 409);
    if (target.status === "invited") {
      await this.operators.auth.cancelInvitation(request, targetId);
    } else await this.operators.auth.setOperatorStatus(request, targetId, "inactive");
    const row = await this.binding.prepare("SELECT removed_at FROM operators WHERE id=?").bind(targetId).first<{ removed_at: string }>();
    if (!row?.removed_at) throw new Error("Base operator projection unavailable");
    await revokeOperatorMail(this.binding, { id: targetId, removedAt: row.removed_at }, nowIso()).run();
    await eraseRemovedOperator(this.binding, target, { id: actor.operator.id, sessionId: actor.id }, this.secret);
    return true;
  }
}
