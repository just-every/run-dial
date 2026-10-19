import type { RuntimeEnvironment } from "../../shared/runtime-env";

type InvitationRuntime = Pick<RuntimeEnvironment, "SESSION_SECRET" | "APP_URL">;
const encoder = new TextEncoder();

async function signingKey(runtime: InvitationRuntime) {
  return crypto.subtle.importKey("raw", encoder.encode(runtime.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
function material(id: string) { return encoder.encode(`dial.invitation-manage.v1:${id}`); }

/** A stable, single-booking mail capability; never a booking-read capability. */
export async function invitationManageUrl(bookingId: string, runtime: InvitationRuntime) {
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(runtime), material(bookingId)));
  const encoded = btoa(String.fromCharCode(...signature)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return new URL(`/manage/invite/${bookingId}.${encoded}`, runtime.APP_URL).toString();
}

export async function invitationBookingId(token: string, runtime: InvitationRuntime): Promise<string | undefined> {
  const parts = /^([0-9A-HJKMNP-TV-Z]{26})\.([A-Za-z0-9_-]{43})$/u.exec(token);
  if (!parts) return undefined;
  const signature = Uint8Array.from(atob(parts[2].replaceAll("-", "+").replaceAll("_", "/") + "="), character => character.charCodeAt(0));
  const canonical = btoa(String.fromCharCode(...signature)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  if (canonical !== parts[2]) return undefined;
  return await crypto.subtle.verify("HMAC", await signingKey(runtime), signature, material(parts[1])) ? parts[1] : undefined;
}
