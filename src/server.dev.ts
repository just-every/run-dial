// Local-only Worker entry. vite.config.ts loads it only for `vite dev`; the deployed main stays src/core/app/worker.ts,
// and `rer build` refuses any output that contains the dev layer. It adds dev sign-in, personas and the dev badge.
import worker from "./core/app/worker";
import { withDevIdentity } from "../modules/operator-auth/dev/index.mjs";
import { localRuntime, operatorAuthConfig } from "./core/features/operators/auth-config";
import { devPersonas } from "./core/features/operators/dev-personas";
import { parseRuntimeEnvironment } from "./core/shared/runtime-env";
import type { AppBindings } from "./core/app/bindings";

export { BookingCoordinator } from "./core/app/worker";

/** The dev layer reads the origin and local switch under Base's names; Dial's settings keep theirs. */
const withAuthOrigin = (env: AppBindings) => {
  const runtime = parseRuntimeEnvironment(env as unknown as Record<string, unknown>);
  return { ...env, AUTH_ORIGIN: new URL(runtime.APP_URL).origin, AUTH_LOCAL: String(localRuntime(runtime)) };
};

export default withDevIdentity<AppBindings, typeof worker>(worker, {
  bindings: withAuthOrigin,
  config: (env) => operatorAuthConfig(parseRuntimeEnvironment(env as unknown as Record<string, unknown>)),
  personas: devPersonas,
});
