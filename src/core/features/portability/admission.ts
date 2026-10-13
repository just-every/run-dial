/** All application execution enters here, including reads (native auth can write).
 * Nested coordinator calls retain independent receipts. An export can acquire
 * only when every admitted operation, including waitUntil work, has drained. */
const duration = 5 * 60_000;
export class ArchiveMaintenance extends Error {}
export async function enterApplication(db: D1Database) {
 const id = crypto.randomUUID();
 const result = await db.prepare("INSERT INTO dial_portability_admission(id,kind,expires_at) SELECT ?,'writer',NULL WHERE NOT EXISTS(SELECT 1 FROM dial_portability_admission WHERE kind='export' AND expires_at>?)").bind(id, Date.now()).run();
 if (!result.meta.changes) throw new ArchiveMaintenance();
 return async () => { await db.prepare("DELETE FROM dial_portability_admission WHERE id=? AND kind='writer'").bind(id).run(); };
}
export async function withApplication<T>(db: D1Database, work: () => Promise<T>): Promise<T> {
 const leave = await enterApplication(db);
 try { return await work(); } finally { await leave(); }
}
export const maintenanceResponse = () => Response.json({ error: "archive_maintenance", message: "An owner export is taking a consistent snapshot. Try again shortly." }, { status: 503, headers: { "Retry-After": "10", "Cache-Control": "no-store" } });
export async function acquireExport(db: D1Database, id: string) {
 const now = Date.now();
 // Expired jobs cannot be resumed: the source may have changed after expiry.
 await db.prepare("DELETE FROM dial_portability_admission WHERE kind='export' AND expires_at<=?").bind(now).run();
 const result = await db.prepare("INSERT INTO dial_portability_admission(id,kind,expires_at) SELECT ?,'export',? WHERE NOT EXISTS(SELECT 1 FROM dial_portability_admission)").bind(id, now + duration).run();
 if (!result.meta.changes) throw new ArchiveMaintenance();
}
export async function renewExport(db: D1Database, id: string) {
 const now = Date.now();
 const result = await db.prepare("UPDATE dial_portability_admission SET expires_at=? WHERE id=? AND kind='export' AND expires_at>?").bind(now + duration, id, now).run();
 if (!result.meta.changes) throw new ArchiveMaintenance();
}
export async function releaseExport(db: D1Database, id: string) {
 await db.prepare("DELETE FROM dial_portability_admission WHERE id=? AND kind='export'").bind(id).run();
}
