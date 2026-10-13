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

/**
 * Checks each bound persistent primitive without changing user data. Every
 * primitive has its own deadline, so one slow or pending provider call marks only
 * that primitive unavailable, and the response returns within the deadline even
 * if a provider leaves an operation pending.
 */
export async function checkPlatformBindings(bindings: PlatformHealthBindings, timeoutMs = 1_000): Promise<PlatformHealth> {
  const [database, storage, queue] = await Promise.all([
    outcome(() => bindings.database.prepare("SELECT 1").run(), timeoutMs),
    outcome(() => bindings.files.head("__dial_health_check__/binding-probe"), timeoutMs),
    outcome(() => bindings.jobs.send({ kind: "health" } satisfies PlatformHealthJob), timeoutMs),
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
