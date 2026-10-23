import { isLoopbackHost } from "../../../modules/operator-auth/index.mjs";

/** Apply the launcher's selected origin after Wrangler loads saved private settings. */
export function localRuntimeBindings<T extends Record<string, unknown>>(bindings: T): T {
  if (bindings.RER_DEV_ORIGIN === undefined) return bindings;
  let origin: URL;
  try {
    if (typeof bindings.RER_DEV_ORIGIN !== "string") throw new Error();
    origin = new URL(bindings.RER_DEV_ORIGIN);
  } catch { throw new Error("Invalid local runtime origin"); }
  if (bindings.ENVIRONMENT !== "development" || origin.protocol !== "http:" || !isLoopbackHost(origin.hostname) || origin.origin !== bindings.RER_DEV_ORIGIN) {
    throw new Error("Local runtime origin requires an explicit loopback development origin");
  }
  return { ...bindings, APP_URL: origin.origin };
}
