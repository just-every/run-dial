/** Only the DNS and receiver network edges are synthetic; payload bytes cross HTTP. */
export function webhookWire(): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "cloudflare-dns.com") {
      const host = url.searchParams.get("name");
      const type = Number(url.searchParams.get("type"));
      return Response.json({ Status: 0, Answer: type === 1 ? [{ type, data: host === "private.synthetic.test" ? "127.0.0.1" : "93.184.216.34" }] : [] });
    }
    if (url.hostname !== "receiver.synthetic.test") throw new Error("Unexpected webhook receiver");
    return fetch(`http://127.0.0.1:15756${url.pathname}`, init);
  };
}
