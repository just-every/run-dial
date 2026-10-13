import { isLoopbackHost } from "../../../modules/operator-auth/index.mjs";
import type { z } from "zod";
import { runtimeEnvironmentSchema } from "./runtime-env-schema.mjs";

export type RuntimeEnvironment = z.infer<typeof runtimeEnvironmentSchema>;

export class RuntimeConfigurationError extends Error {
  constructor(readonly missing: string[]) {
    super(`Missing runtime configuration: ${missing.join(", ")}`);
  }
}

export function parseRuntimeEnvironment(env: Record<string, unknown>): RuntimeEnvironment {
  const missing = ["ENVIRONMENT", "APP_URL", "SESSION_SECRET"].filter(
    (name) => typeof env[name] !== "string" || env[name].trim() === "",
  );
  if (missing.length > 0) throw new RuntimeConfigurationError(missing);

  const parsed = runtimeEnvironmentSchema.safeParse(env);
  if (parsed.success) {
    if (parsed.data.MAIL_PROVIDER === "development" && (parsed.data.ENVIRONMENT !== "development" || !isLoopbackHost(new URL(parsed.data.APP_URL).hostname))) throw new Error("Invalid runtime configuration: development mail requires a loopback development install");
    return parsed.data;
  }
  throw new Error(`Invalid runtime configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
}

export function googleCalendarConfiguration(runtime: RuntimeEnvironment) {
  const { GOOGLE_OAUTH_CLIENT_ID: clientId, GOOGLE_OAUTH_CLIENT_SECRET: clientSecret, CALENDAR_WEBHOOK_SECRET: webhookSecret } = runtime;
  return clientId && clientSecret ? { clientId, clientSecret, webhookSecret } : undefined;
}
