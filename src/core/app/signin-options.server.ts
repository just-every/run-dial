import { env } from "cloudflare:workers";
import type { AppBindings } from "./bindings";
import { signinOptions } from "../features/operators/signin-options";
import { localRuntimeBindings } from "../shared/local-runtime-bindings";

export function readSigninOptions(loginHint?: string) {
  return signinOptions(localRuntimeBindings(env as unknown as AppBindings), loginHint);
}
