export type OAuthState = { id: string; sessionId: string; operatorId: string; issuedAt: string };

export async function signOAuthState(value: OAuthState, secret: string) {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  const signature = await crypto.subtle.sign("HMAC", await stateKey(secret), new TextEncoder().encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyOAuthState(value: string, secret: string): Promise<OAuthState | undefined> {
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra) return undefined;
  try {
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC", await stateKey(secret), new TextEncoder().encode(body)));
    if (!sameBytes(expected, fromBase64Url(signature))) return undefined;
    const decoded: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
    if (!decoded || typeof decoded !== "object") return undefined;
    const entry = decoded as Record<string, unknown>;
    return typeof entry.id === "string" && typeof entry.sessionId === "string" && typeof entry.operatorId === "string" && typeof entry.issuedAt === "string"
      ? { id: entry.id, sessionId: entry.sessionId, operatorId: entry.operatorId, issuedAt: entry.issuedAt }
      : undefined;
  } catch {
    return undefined;
  }
}

export function sameSecret(expected: string, actual: string | null) {
  if (!actual) return false;
  return sameBytes(new TextEncoder().encode(expected), new TextEncoder().encode(actual));
}

export async function payloadHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(digest));
}

async function stateKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function toBase64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left[index] ^ right[index];
  return different === 0;
}
