import { enterApplication, ArchiveMaintenance, maintenanceResponse } from "./admission";

/** Admit only after request checks, retaining the receipt through waitUntil work. */
export function applicationRequest(db: D1Database, context: ExecutionContext, work: (admit: () => Promise<void>, context: ExecutionContext) => Promise<Response>, deferredReads: () => Promise<unknown>[] = () => []) {
 const operation = (async () => {
  let leave: (() => Promise<void>) | undefined;
  const pending: Promise<unknown>[] = [];
  const tracked = {
   waitUntil(task: Promise<unknown>) { pending.push(task); },
   passThroughOnException() { context.passThroughOnException(); },
  } as ExecutionContext;
  try {
   const response = await work(async () => { leave ??= await enterApplication(db); }, tracked);
   if (leave && deferredReads().length && response.body) {
    // Keep the export admission through deferred provider writes and stream EOF,
    // without holding the document's first byte behind the remaining work.
    const release = leave;
    leave = undefined;
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    context.waitUntil((async () => {
     try { await response.body!.pipeTo(writable); }
     finally { await Promise.allSettled([...pending, ...deferredReads()]); await release(); }
    })());
    return new Response(readable, { status: response.status, statusText: response.statusText, headers: response.headers });
   }
   return response;
  } catch (error) {
   if (error instanceof ArchiveMaintenance) return maintenanceResponse();
   throw error;
  } finally {
   if (leave) { await Promise.allSettled([...pending, ...deferredReads()]); await leave(); }
  }
 })();
 // A disconnect must not cancel the admitted work or its receipt cleanup.
 context.waitUntil(operation);
 return operation;
}
