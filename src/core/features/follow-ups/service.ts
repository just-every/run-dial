import type { RuntimeEnvironment } from "../../shared/runtime-env";
import { nowIso } from "../../shared/ids";
import { FollowUpsRepository } from "./repository";
import { composeFollowUp, followUpTemplateIssue } from "./templates";
import type { FollowUpSettings } from "./types";
export class FollowUpsService {
  constructor(private readonly repository: FollowUpsRepository, private readonly runtime: RuntimeEnvironment) {}
  settings(eventId: string) { return this.repository.settings(eventId); }
  history(bookingId: string) { return this.repository.history(bookingId); }
  async save(eventId: string, settings: FollowUpSettings) {
    const issue = followUpTemplateIssue(settings.text, await this.repository.questionKeys(eventId));
    if (issue) return { kind: "invalid_template" as const, message: issue };
    if (settings.targetEventTypeId && !await this.repository.validTarget(settings.targetEventTypeId)) return { kind: "invalid_target" as const };
    return await this.repository.save(eventId, settings) ? { kind: "saved" as const } : { kind: "not_found" as const };
  }
  async tick(now = nowIso()) {
    const due = await this.repository.due(now);
    for (const run of due) {
      if (!run.enabled) { await this.repository.recordSkipped(run, "setting_disabled", now); continue; }
      if (run.attendedOnly && run.attendance !== "attended") { await this.repository.wait(run, run.attendance === "no_show" ? "no_show" : "attendance_required", now); continue; }
      if (run.kind === "rebooking" && (!run.targetSlug || !run.targetPublished)) { await this.repository.recordSkipped(run, "rebooking_target_unavailable", now); continue; }
      try { await this.repository.enqueue(run, composeFollowUp(run, this.runtime.APP_URL), now); }
      catch (error) { if (error instanceof Error && error.message === "private_link_not_allowed") await this.repository.recordSkipped(run, "private_link_not_allowed", now); else if (error instanceof TypeError) await this.repository.fail(run, "invalid_follow_up_template", now); else throw error; }
    }
    return { checked: due.length };
  }
}
