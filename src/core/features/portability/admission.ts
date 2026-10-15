/** All application execution enters here, including reads (native auth can write).
 * Nested coordinator calls retain independent receipts. An export can acquire
 * only when every admitted operation, including waitUntil work, has drained. */
const duration = 5 * 60_000;
// Evaluate leases at D1 execution time, even if a request waited in its queue.
const clock = "CAST(unixepoch('subsec')*1000 AS INTEGER)";
export class ArchiveMaintenance extends Error {}
export class ArchiveWritersPresent extends ArchiveMaintenance {}
const statusQuery = `SELECT (SELECT count(*) FROM dial_portability_admission WHERE kind='writer') AS writerAdmissions,
 EXISTS(SELECT 1 FROM dial_portability_admission WHERE kind='export' AND expires_at>${clock}) AS activeExport`;
type AdmissionObservation = { writerAdmissions: number; activeExport: number };
export type ArchiveStatus = { writerAdmissions: number; activeExport: boolean; writerLiveness: "unknown" };
export async function archiveStatus(db: D1Database): Promise<ArchiveStatus> {
 const state = await db.prepare(statusQuery).first<AdmissionObservation>();
 if (!state) throw new Error("archive_status_unavailable");
 return { writerAdmissions: state.writerAdmissions, activeExport: Boolean(state.activeExport), writerLiveness: "unknown" };
}
export async function enterApplication(db: D1Database) {
 const id = crypto.randomUUID();
 const result = await db.prepare(`INSERT INTO dial_portability_admission(id,kind,expires_at) SELECT ?,'writer',NULL WHERE NOT EXISTS(SELECT 1 FROM dial_portability_admission WHERE kind='export' AND expires_at>${clock})`).bind(id).run();
 if (!result.meta.changes) throw new ArchiveMaintenance();
 return async () => { await db.prepare("DELETE FROM dial_portability_admission WHERE id=? AND kind='writer'").bind(id).run(); };
}
export async function withApplication<T>(db: D1Database, work: () => Promise<T>): Promise<T> {
 const leave = await enterApplication(db);
 try { return await work(); } finally { await leave(); }
}
export const maintenanceResponse = () => Response.json({ error: "archive_maintenance", message: "An owner export is taking a consistent snapshot. Try again shortly." }, { status: 503, headers: { "Retry-After": "10", "Cache-Control": "no-store" } });
export async function acquireExport(db: D1Database, id: string) {
 // Expired jobs cannot be resumed: the source may have changed after expiry.
 // Observe the refusal in the same transaction as acquisition, before another
 // request can change its cause. Never infer writer age or liveness from a row.
 const [, result, observation] = await db.batch([
  db.prepare(`DELETE FROM dial_portability_admission WHERE kind='export' AND expires_at<=${clock}`),
  db.prepare(`INSERT INTO dial_portability_admission(id,kind,expires_at) SELECT ?,'export',${clock}+? WHERE NOT EXISTS(SELECT 1 FROM dial_portability_admission)`).bind(id, duration),
  db.prepare(statusQuery),
 ]);
 if (!result.meta.changes) {
  if ((observation.results[0] as AdmissionObservation).writerAdmissions > 0) throw new ArchiveWritersPresent();
  throw new ArchiveMaintenance();
 }
}
export async function renewExport(db: D1Database, id: string) {
 const result = await db.prepare(`UPDATE dial_portability_admission SET expires_at=${clock}+? WHERE id=? AND kind='export' AND expires_at>${clock}`).bind(duration, id).run();
 if (!result.meta.changes) throw new ArchiveMaintenance();
}
export async function releaseExport(db: D1Database, id: string) {
 await db.prepare("DELETE FROM dial_portability_admission WHERE id=? AND kind='export'").bind(id).run();
}
