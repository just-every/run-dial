import { isLoopbackHost } from "../../../../modules/operator-auth/index.mjs";
import type { RuntimeEnvironment } from "../../shared/runtime-env";

type LocalMailRuntime = Pick<RuntimeEnvironment, "ENVIRONMENT" | "APP_URL" | "RER_DEMO">;
/** Dev and demo mail completes without retaining or delivering a message. */
export function suppressesMail(runtime: Partial<LocalMailRuntime>): boolean {
  return runtime.RER_DEMO === "1" || (runtime.ENVIRONMENT === "development" && Boolean(runtime.APP_URL) && isLoopbackHost(new URL(runtime.APP_URL!).hostname));
}
