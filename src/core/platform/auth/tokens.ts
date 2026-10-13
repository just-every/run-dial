function encode(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function createOpaqueToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encode(bytes);
}

export async function hashToken(token: string, secret: string) {
  const input = new TextEncoder().encode(`${secret}:${token}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return encode(new Uint8Array(digest));
}

/** Derives a replayable opaque capability from an already random one-time nonce. */
export async function deriveOpaqueToken(nonce: string, secret: string, purpose: string) {
  const input = new TextEncoder().encode(`${purpose}:${secret}:${nonce}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return encode(new Uint8Array(digest));
}
