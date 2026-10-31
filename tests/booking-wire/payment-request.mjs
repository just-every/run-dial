import { request } from "node:http";

/**
 * One socket per payment request, including overlapping entitlement selections.
 * workerd can close an idle keep-alive socket after a slow SQLite request; an
 * unrelated request must never inherit that socket. agent:false creates a new
 * connection for every call, with no shared pool, retry or concurrency limit.
 * Buffer the response before returning so callers need not drain unused bodies.
 */
export function paymentFetch(url, { method = "GET", headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { method, headers, agent: false }, incoming => {
      const chunks = [];
      incoming.on("data", chunk => chunks.push(chunk));
      incoming.on("error", reject);
      incoming.on("end", () => {
        const status = incoming.statusCode;
        const responseHeaders = new Headers();
        for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
          responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
        }
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers: responseHeaders }));
      });
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}
