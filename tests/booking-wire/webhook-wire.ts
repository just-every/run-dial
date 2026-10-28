/** Only the DNS and receiver network edges are synthetic; payload bytes cross HTTP. */
export function webhookWire(receiver = "http://127.0.0.1:15756"): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "cloudflare-dns.com") {
      return fetch(`${receiver}/__dns${url.search}`, init);
    }
    if (url.hostname !== "receiver.synthetic.test") throw new Error("Unexpected webhook receiver");
    return fetch(`${receiver}${url.pathname}`, init);
  };
}
