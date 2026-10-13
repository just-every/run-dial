import { createId, nowIso } from "../../shared/ids";
import { createErasure } from "../../../modules/erasure/index.mjs";
import { erasurePortability } from "./portability";
import { bookingGraph, requestGraph } from "./graphs";
import { foldEmail } from "./identity";
import type { SessionRecord } from "../operators";
import { admitErasure, erasureAuthority } from "./admission";
import { deleteRows, recordAddressStatements } from "./address";
import { bookingErasureCapture, bookingErasureFinish, type ErasureStatement } from "./booking-statements";
import { calendarErasureRepair } from "./calendar-repair";

/** Local erasure and anonymized audit commit together; remote cleanup retains only a provider lookup key. */
export class ErasureRepository {
  constructor(private readonly db: D1Database, private readonly secret: string) {}

  async booking(id: string, session: SessionRecord, commit?: (statements: ErasureStatement[]) => Promise<void>) {
    const exists = await this.db.prepare("SELECT invitee_email AS email FROM bookings WHERE id = ?").bind(id).first<{ email: string }>();
    if (!exists) {
      const cleanup = await this.cleanupStatus(id);
      return cleanup ? { kind: "erased" as const, localComplete: true, calendarCleanup: cleanup.completedAt ? "completed" as const : "pending" as const, id } : { kind: "not_found" as const };
    }
    const fence = await erasurePortability(this.db);
    const email = foldEmail(exists.email);
    await admitErasure(this.db, email, session);
    const engine = createErasure({ db: this.db, portability: fence, declarations: [bookingGraph()] });
    const plan = await engine.nativeStatements("booking", { id });
    const address = await recordAddressStatements(this.db, fence, "bookings", id, this.secret);
    // The helper re-reads its planned rows first; address cleanup that overlaps them runs after.
    const statements = [erasureAuthority(session), ...bookingErasureCapture(id, session.id), ...plan.statements, ...address, ...bookingErasureFinish(id),
      ...await deleteRows(this.db, fence, "person_erasure_locks", "email=? AND receipt_id IS NULL", [email]), erasureAuthority(session)];
    if (commit) await commit(statements);
    else await this.db.batch(statements.map(statement => this.db.prepare(statement.sql).bind(...statement.params)));
    await engine.deleteBlobs(plan.operationId);
    const cleanup = await this.cleanupStatus(id);
    return { kind: "erased" as const, localComplete: true, calendarCleanup: cleanup && !cleanup.completedAt ? "pending" as const : "completed" as const, id };
  }

  async request(id: string, session: SessionRecord) {
    const exists = await this.db.prepare("SELECT invitee_email AS email FROM availability_requests WHERE id=?").bind(id).first<{ email: string }>();
    if (!exists) return false;
    const fence = await erasurePortability(this.db);
    const email = foldEmail(exists.email);
    await admitErasure(this.db, email, session);
    const engine = createErasure({ db: this.db, portability: fence, declarations: [requestGraph()] });
    const plan = await engine.nativeStatements("availability-request", { id });
    const now = nowIso();
    const statements: ErasureStatement[] = [erasureAuthority(session),
      { sql: "INSERT INTO anonymized_audit (id, entity_kind, action, actor_type, actor_id, happened_at, erased_at) SELECT ?, 'availability_request', 'erased', 'operator', ?, ?, ? WHERE EXISTS (SELECT 1 FROM availability_requests WHERE id = ?)", params: [createId(), session.id, now, now, id] },
      // The helper re-reads its planned rows first; address cleanup that overlaps them runs after.
      ...plan.statements, ...await recordAddressStatements(this.db, fence, "availability_requests", id, this.secret),
      ...await deleteRows(this.db, fence, "person_erasure_locks", "email=? AND receipt_id IS NULL", [email]), erasureAuthority(session),
    ];
    await this.db.batch(statements.map(statement => this.db.prepare(statement.sql).bind(...statement.params)));
    await engine.deleteBlobs(plan.operationId);
    return true;
  }

  async reconcileCalendarFact(id: string, kind: "changed" | "deleted", source: string) {
    if (kind !== "changed") return;
    await this.db.batch(calendarErasureRepair(id, `repair:${source}`, source).map(statement => this.db.prepare(statement.sql).bind(...statement.params)));
  }

  async cleanupStatus(id: string) {
    return this.db.prepare("SELECT booking_id AS id, created_at AS createdAt, completed_at AS completedAt, last_error_code AS lastErrorCode FROM erased_calendar_targets WHERE booking_id = ?").bind(id).first<{ id: string; createdAt: string; completedAt: string | null; lastErrorCode: string | null }>();
  }
}
