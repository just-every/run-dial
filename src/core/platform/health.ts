import { z } from "zod";

/** A harmless queue command used only to prove the bound Queue accepts messages. */
export const platformHealthJobSchema = z.object({ kind: z.literal("health") }).strict();
export type PlatformHealthJob = z.infer<typeof platformHealthJobSchema>;

export function isPlatformHealthJob(value: unknown): value is PlatformHealthJob {
  return platformHealthJobSchema.safeParse(value).success;
}

export type PlatformHealthBindings = {
  database: D1Database;
  files: R2Bucket;
  jobs: Queue;
};

export type PlatformHealth = {
  checks: { database: "ok" | "unavailable"; storage: "ok" | "unavailable"; queue: "ok" | "unavailable" };
  status: "ok" | "unavailable";
};

const platformBindingHealthTimeoutMs = 1_000;
const platformQueueHealthTimeoutMs = 12_000;

/**
 * Checks each bound persistent primitive without changing user data. Every
 * primitive has its own deadline, so one slow or pending provider call marks only
 * that primitive unavailable. The first Queue send from a fresh Worker can take
 * longer to settle than the D1 and R2 probes, so it has its own bounded window.
 */
export async function checkPlatformBindings(
  bindings: PlatformHealthBindings,
  deadlines: { databaseAndStorageMs?: number; queueMs?: number } = {},
): Promise<PlatformHealth> {
  const databaseAndStorageMs = deadlines.databaseAndStorageMs ?? platformBindingHealthTimeoutMs;
  const queueMs = deadlines.queueMs ?? platformQueueHealthTimeoutMs;
  const [database, storage, queue] = await Promise.all([
    outcome(() => bindings.database.prepare("SELECT 1").run(), databaseAndStorageMs),
    outcome(() => bindings.files.head("__dial_health_check__/binding-probe"), databaseAndStorageMs),
    outcome(() => bindings.jobs.send({ kind: "health" } satisfies PlatformHealthJob), queueMs),
  ]);
  const checks = { database, storage, queue } as const;
  return { checks, status: Object.values(checks).every((state) => state === "ok") ? "ok" : "unavailable" };
}

async function outcome(operation: () => Promise<unknown>, timeoutMs: number): Promise<"ok" | "unavailable"> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("health_timeout")), timeoutMs); }),
    ]);
    return "ok";
  } catch {
    return "unavailable";
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
