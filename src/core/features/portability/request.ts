import { enterApplication, ArchiveMaintenance, maintenanceResponse } from "./admission";

/** Admit only after request checks, retaining the receipt through waitUntil work. */
export function applicationRequest(db: D1Database, context: ExecutionContext, work: (admit: () => Promise<void>, context: ExecutionContext) => Promise<Response>) {
 const operation = (async () => {
  let leave: (() => Promise<void>) | undefined;
  const pending: Promise<unknown>[] = [];
  const tracked = {
   waitUntil(task: Promise<unknown>) { pending.push(task); },
   passThroughOnException() { context.passThroughOnException(); },
  } as ExecutionContext;
  try {
   return await work(async () => { leave ??= await enterApplication(db); }, tracked);
  } catch (error) {
   if (error instanceof ArchiveMaintenance) return maintenanceResponse();
   throw error;
  } finally {
   if (leave) { await Promise.allSettled(pending); await leave(); }
  }
 })();
 // A disconnect must not cancel the admitted work or its receipt cleanup.
 context.waitUntil(operation);
 return operation;
}
