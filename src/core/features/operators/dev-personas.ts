import type { DevPersona } from "../../../../modules/operator-auth/dev/index.mjs";

/**
 * Local dev personas: real operators at <as>@dev.localhost, created only by local dev sign-in and suspended in exports.
 * Dial's operators are equals (the owner role), so the second persona is a co-host the owner invited; a booker is the
 * signed-out choice. Only src/server.dev.ts uses this.
 */
export function devPersonas(): DevPersona[] {
  return [{ as: "co-host", role: "owner", displayName: "Dev co-host" }];
}
