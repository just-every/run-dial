import { getRequest } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";
import { nativeRequestSession, privateRequestServices } from "./private-request.server";
import { createServices } from "./services";
import { parseRuntimeEnvironment } from "../shared/runtime-env";
import { env } from "cloudflare:workers";
import type { AppBindings } from "./bindings";
import { signinOptions } from "../features/operators/signin-options";
import { localRuntimeBindings } from "../shared/local-runtime-bindings";

export async function readSigninOptions(loginHint?: string) {
  const bound = env as unknown as AppBindings;
  const runtime = parseRuntimeEnvironment(bound);
  const services = privateRequestServices(bound) ?? createServices(bound.DB, runtime, bound.ASSETS, { files: bound.FILES });
  if (await nativeRequestSession(getRequest(), services.operators.auth)) throw redirect({ to: "/app" });
  return signinOptions(localRuntimeBindings(bound), loginHint);
}
