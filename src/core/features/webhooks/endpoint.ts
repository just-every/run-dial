import { checkedUrl, dohResolver } from "../../platform/site-reader/fetch";
import { isIpLiteral, isPublicAddress } from "../../platform/site-reader/address";

/** Resolve again before every attempt; redirects never receive a signed payload. */
export async function webhookEndpoint(value: string, transport: typeof fetch) {
  const url = checkedUrl(value);
  if (url.protocol !== "https:" || url.hash) throw new Error("endpoint_not_public_https");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIpLiteral(host) ? [host] : await dohResolver(transport)(host);
  if (!addresses.length || !addresses.every(isPublicAddress)) throw new Error("endpoint_not_public_https");
  return url.href;
}

export async function webhookSignature(secret: string, timestamp: number, body: string) {
  const encode = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encode.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encode.encode(`${timestamp}.${body}`)));
  return `t=${timestamp},v1=${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
