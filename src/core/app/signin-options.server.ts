import { env } from "cloudflare:workers";
import type { AppBindings } from "./bindings";
import { signinOptions } from "../features/operators/signin-options";

export function readSigninOptions(loginHint?: string) {
  return signinOptions(env as unknown as AppBindings, loginHint);
}
