import { signedOwnerClaimConfigured } from "./owner-claim.server";
import { signinPresentation } from "../../../../modules/local-signin/signin-options.server.mjs";
import type { AppBindings } from "../../app/bindings";

export async function signinOptions(bindings: Pick<AppBindings, "DB" | "SETUP_TOKEN" | "ENVIRONMENT" | "APP_URL" | "MAIL_PROVIDER" | "RER_OWNER_CLAIM_ISSUER" | "RER_OWNER_CLAIM_INSTALLATION_ID" | "RER_OWNER_CLAIM_APP_ORIGIN" | "RER_OWNER_CLAIM_PUBLIC_KEYS">) {
  const claimed = await bindings.DB.prepare("SELECT singleton FROM oa_bootstrap LIMIT 1").first();
  return {
    setup: Boolean(bindings.SETUP_TOKEN) && !claimed && !signedOwnerClaimConfigured(bindings),
    ...signinPresentation({ AUTH_LOCAL: bindings.ENVIRONMENT === "development" ? "true" : "false", AUTH_ORIGIN: bindings.APP_URL, MAIL_PROVIDER: bindings.MAIL_PROVIDER }),
  };
}
