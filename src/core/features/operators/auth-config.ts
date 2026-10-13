import { isLoopbackHost, type AuthConfig } from "../../../../modules/operator-auth/index.mjs";
import { RuntimeConfigurationError, type RuntimeEnvironment } from "../../shared/runtime-env";

/** The browser installer and the sign-in confirmation page read this file; the Worker serves it from public/. */
const theme = "/rer-theme.css";

/** True for a loopback, non-production runtime: the only place local sign-in and the dev layer may run. */
export function localRuntime(runtime: Pick<RuntimeEnvironment, "ENVIRONMENT" | "APP_URL">) {
  return runtime.ENVIRONMENT !== "production" && isLoopbackHost(new URL(runtime.APP_URL).hostname);
}

/** The one operator-auth configuration: the product's service and its local-only dev entry both build from it. */
export function operatorAuthConfig(runtime: RuntimeEnvironment): AuthConfig {
  const { OWNER_EMAIL, APP_URL, SESSION_SECRET, SETUP_TOKEN, MAIL_FROM, RESEND_FROM_EMAIL } = runtime;
  if (!OWNER_EMAIL) throw new RuntimeConfigurationError(["OWNER_EMAIL"]);
  return { origin: new URL(APP_URL).origin, OWNER_EMAIL, SESSION_SECRET, SETUP_TOKEN, local: localRuntime(runtime),
    MAIL_FROM: MAIL_FROM ?? RESEND_FROM_EMAIL, sessionSeconds: 30 * 86400,
    branding: { productName: "Dial", accentColor: "#1d1c1a", signInPath: "/signin", theme } };
}
