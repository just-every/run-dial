// Copied from just-every/run-lamp 195e73ac src/core/platform/site-reader/fetch.ts (gr G1), with Dial's user agent and a file over its limit told apart (FileTooLarge); the round that adopts Base's shared reader deletes this copy.
import { isIpLiteral, isPublicAddress } from "./address.ts";
import type { SiteReadFailure } from "./types.ts";

export class SiteReadError extends Error {
  readonly reason: SiteReadFailure;
  constructor(reason: SiteReadFailure, message: string) { super(message); this.reason = reason; }
}

/** A file over its size limit: the read goes on without it, and says why it is missing. */
export class FileTooLarge extends SiteReadError {
  constructor() { super("unreachable", "That file is too large."); }
}

export interface GuardedFetchContext {
  fetch: typeof fetch;
  resolve: (hostname: string) => Promise<string[]>;
  signal: AbortSignal;
  maxRedirects: number;
}

// Names the reader, in the form browsers and crawlers share, so a font host answers with the format a browser gets (woff2).
const USER_AGENT = "Mozilla/5.0 (compatible; DialSiteReader/1.0; +https://run-dial.com) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** Only http(s) on default ports, no credentials, and a host name that resolves to public addresses only. */
export function checkedUrl(value: string | URL): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new SiteReadError("invalid-url", "Enter a website address like example.com."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SiteReadError("invalid-url", "Enter a website address like example.com.");
  if (url.username || url.password || url.port) throw new SiteReadError("refused-address", "That address isn't a public website.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!isIpLiteral(host) && (!host.includes(".") || /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/.test(host))) {
    throw new SiteReadError("refused-address", "That address isn't a public website.");
  }
  return url;
}

async function assertPublicHost(url: URL, context: GuardedFetchContext) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIpLiteral(host) ? [host] : await context.resolve(host).catch(() => { throw new SiteReadError("unreachable", "We couldn't reach that website."); });
  if (!addresses.length) throw new SiteReadError("unreachable", "We couldn't reach that website.");
  if (!addresses.every(isPublicAddress)) throw new SiteReadError("refused-address", "That address isn't a public website.");
}

/** Fetch with every redirect hop re-checked, then read at most maxBytes.
 * A larger body is cut at maxBytes when truncate is set and refused otherwise. */
export async function guardedFetch(start: URL, accept: string, maxBytes: number, truncate: boolean, context: GuardedFetchContext) {
  let url = start;
  for (let hop = 0; ; hop++) {
    url = checkedUrl(url);
    await assertPublicHost(url, context);
    let response: Response;
    try {
      response = await context.fetch(url.href, { redirect: "manual", signal: context.signal, headers: { Accept: accept, "User-Agent": USER_AGENT } });
    } catch {
      throw context.signal.aborted ? new SiteReadError("timeout", "That website took too long to answer.") : new SiteReadError("unreachable", "We couldn't reach that website.");
    }
    const location = response.headers.get("Location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      if (hop >= context.maxRedirects) throw new SiteReadError("unreachable", "That website redirects too many times.");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SiteReadError("http-error", "We couldn't read that website.");
    }
    const declared = Number(response.headers.get("Content-Length"));
    if (!truncate && declared > maxBytes) {
      await response.body?.cancel();
      throw new FileTooLarge();
    }
    return { url, contentType: response.headers.get("Content-Type") ?? "", bytes: await readCapped(response, maxBytes, truncate, context.signal) };
  }
}

async function readCapped(response: Response, maxBytes: number, truncate: boolean, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        await reader.cancel();
        if (!truncate) throw new FileTooLarge();
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (cause) {
    if (cause instanceof SiteReadError) throw cause;
    throw signal.aborted ? new SiteReadError("timeout", "That website took too long to answer.") : new SiteReadError("unreachable", "We couldn't reach that website.");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** A and AAAA records over DNS-over-HTTPS (RFC 8484 JSON form). */
export function dohResolver(transport: typeof fetch = fetch) {
  return async (hostname: string) => {
    const answers = await Promise.all([1, 28].map(async (type) => {
      const response = await transport(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error("DNS lookup failed.");
      const body = await response.json() as { Status?: number; Answer?: { type: number; data: string }[] };
      return body.Status === 0 ? (body.Answer ?? []).filter((answer) => answer.type === type).map((answer) => answer.data) : [];
    }));
    return answers.flat();
  };
}
