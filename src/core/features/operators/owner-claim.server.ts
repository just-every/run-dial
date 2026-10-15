import { createOwnerClaimHandler, OwnerClaimError } from "../../../../modules/owner-claim/index.mjs";
import { AuthError, isLoopbackHost } from "../../../../modules/operator-auth/index.mjs";
import type { RuntimeEnvironment } from "../../shared/runtime-env";

export function signedOwnerClaimConfigured(runtime: Pick<RuntimeEnvironment, "RER_OWNER_CLAIM_ISSUER" | "RER_OWNER_CLAIM_INSTALLATION_ID" | "RER_OWNER_CLAIM_APP_ORIGIN" | "RER_OWNER_CLAIM_PUBLIC_KEYS">) {
  return [runtime.RER_OWNER_CLAIM_ISSUER, runtime.RER_OWNER_CLAIM_INSTALLATION_ID,
    runtime.RER_OWNER_CLAIM_APP_ORIGIN, runtime.RER_OWNER_CLAIM_PUBLIC_KEYS].some(value => value !== undefined);
}

/** Base verifies and atomically consumes the claim; bindings alone define its authority. */
export async function ownerClaim(db: D1Database, runtime: RuntimeEnvironment, request: Request) {
  if (!signedOwnerClaimConfigured(runtime)) return new Response("Not found", { status: 404 });
  try {
    const local = runtime.ENVIRONMENT !== "production" && isLoopbackHost(new URL(runtime.APP_URL).hostname);
    return await createOwnerClaimHandler({
      db,
      authConfig: { origin: new URL(runtime.APP_URL).origin, local, OWNER_EMAIL: runtime.OWNER_EMAIL!,
        SESSION_SECRET: runtime.SESSION_SECRET, SETUP_TOKEN: runtime.SETUP_TOKEN, sessionSeconds: 30 * 86400 },
      clientIp: request => local ? "loopback" : request.headers.get("cf-connecting-ip") ?? "",
      issuer: runtime.RER_OWNER_CLAIM_ISSUER!, installationId: runtime.RER_OWNER_CLAIM_INSTALLATION_ID!,
      // A hosted demo's front sets the claim keys and the exact APP_URL, not a separate claim origin.
      appOrigin: runtime.RER_OWNER_CLAIM_APP_ORIGIN ?? (runtime.RER_DEMO === "1" ? new URL(runtime.APP_URL).origin : undefined)!, expectedEmail: runtime.OWNER_EMAIL!,
      publicKeys: JSON.parse(runtime.RER_OWNER_CLAIM_PUBLIC_KEYS ?? "null"),
    })(request);
  } catch (error) {
    const known = error instanceof OwnerClaimError || error instanceof AuthError;
    return Response.json({ error: known ? error.code : "invalid_configuration" }, {
      status: known ? error.status : 503, headers: { "cache-control": "no-store" },
    });
  }
}
