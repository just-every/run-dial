/** Stripe's webhook signature scheme: `Stripe-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.payload">`,
 * keyed with the endpoint's signing secret, inside a timestamp tolerance (Stripe's libraries default to 300 s). */
export const stripeSignatureToleranceSeconds = 300;

export async function verifyStripeSignature(payload: string, header: string | null, secret: string, nowMs = Date.now(), toleranceSeconds = stripeSignatureToleranceSeconds) {
  if (!header || !secret) return false;
  const parts = header.split(",").map(part => part.trim().split("="));
  const timestamps = parts.filter(([key]) => key === "t").map(([, value]) => value);
  const signatures = parts.filter(([key, value]) => key === "v1" && /^[0-9a-f]{64}$/.test(value ?? "")).map(([, value]) => value);
  if (timestamps.length !== 1 || !/^\d{1,12}$/.test(timestamps[0] ?? "") || !signatures.length) return false;
  const timestamp = Number(timestamps[0]);
  if (Math.abs(nowMs / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = await stripeSignatureHex(`${timestamp}.${payload}`, secret);
  return signatures.some(signature => sameText(expected, signature));
}

export async function stripeSignatureHex(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return [...signature].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function sameText(left: string, right: string) {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}
