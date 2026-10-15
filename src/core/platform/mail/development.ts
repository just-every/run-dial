import { createD1DevelopmentOutbox, createDevelopmentOutboxHandler } from "../../../../modules/mail/src/development/index.mjs";
import { devGate, devNotFound, isLoopbackHost } from "../../../../modules/operator-auth/index.mjs";
import type { RuntimeEnvironment } from "../../shared/runtime-env";

type LocalMailRuntime = Pick<RuntimeEnvironment, "ENVIRONMENT" | "APP_URL" | "MAIL_PROVIDER" | "RER_DEMO">;
export function isLocalOutboxEnabled(runtime: Partial<LocalMailRuntime>): boolean {
  return runtime.ENVIRONMENT === "development" && runtime.MAIL_PROVIDER === "development" && Boolean(runtime.APP_URL) && isLoopbackHost(new URL(runtime.APP_URL!).hostname);
}
/** Mail is captured in the outbox, never sent: a loopback development install, or demo mode (a hosted demo has an https origin). */
export function capturesMail(runtime: Partial<LocalMailRuntime>): boolean {
  return isLocalOutboxEnabled(runtime) || (runtime.RER_DEMO === "1" && runtime.MAIL_PROVIDER === "development");
}
export function developmentOutbox(db: D1Database, runtime: Partial<LocalMailRuntime>) {
  if (!capturesMail(runtime)) throw new Error("Development mail requires explicit local configuration");
  return createD1DevelopmentOutbox({ db });
}
/**
 * The outbox and the dev key exchange answer only a local runtime holding RER_DEV_KEY and a request that passes its gate.
 * A tunnel or local proxy makes remote requests look loopback, so the key, not the origin, is what admits a caller.
 */
export async function handleDevelopmentOutbox(request: Request, db: D1Database, runtime: RuntimeEnvironment, devKey: string | undefined) {
  if (!isLocalOutboxEnabled(runtime)) return null;
  const gate = devGate({ key: devKey, origin: new URL(runtime.APP_URL).origin, local: true });
  if (!gate) return devNotFound();
  if (new URL(request.url).pathname === "/__dev/key") return gate.exchange(request);
  if (!(await gate.admits(request))) return devNotFound();
  return createDevelopmentOutboxHandler({ local: true, origin: runtime.APP_URL, outbox: developmentOutbox(db, runtime) })(request);
}
