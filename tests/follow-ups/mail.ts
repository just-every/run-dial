/** Synthetic mail provider HTTP edge; native composition and dispatch stay unchanged. */
export class SyntheticFollowUpMail {
  readonly messages = new Map<string, Record<string, unknown>>();
  readonly request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), headers = new Headers(init?.headers);
    if (url.origin !== "https://api.resend.com" || headers.get("authorization") !== "Bearer synthetic-dial-1700") return Response.json({}, { status: 401 });
    if (url.pathname === "/domains" && (!init?.method || init.method === "GET")) return Response.json({ data: [{ name: "example.test", status: "verified" }] });
    if (url.pathname === "/emails" && init?.method === "POST") {
      const key = headers.get("idempotency-key"); if (!key) return Response.json({}, { status: 400 });
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const existing = this.messages.get(key); if (existing && JSON.stringify(existing) !== JSON.stringify(body)) return Response.json({}, { status: 409 });
      this.messages.set(key, body); return Response.json({ id: `synthetic-dial-message-${this.messages.size}` });
    }
    throw new Error(`Unexpected synthetic mail HTTP request ${url.pathname}`);
  };
}
