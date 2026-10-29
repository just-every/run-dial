/** Only SendGrid's network boundary is replaced. Native readiness and policy run for real. */
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (
      url.origin !== "https://api.sendgrid.com" ||
      !/^Bearer [^\s]+$/.test(request.headers.get("authorization") ?? "")
    )
      return new Response(null, { status: 401 });
    if (request.method === "GET" && url.pathname === "/v3/verified_senders")
      return Response.json({
        results: [{ id: 1, from_email: "noreply@dial.test", verified: true }],
      });
    if (request.method === "GET" && url.pathname === "/v3/whitelabel/domains")
      return Response.json([{ id: 1, domain: "dial.test", valid: true }]);
    if (request.method === "GET" && url.pathname === "/v3/whitelabel/domains/1")
      return Response.json({ id: 1, domain: "dial.test", valid: true });
    if (request.method === "POST" && url.pathname === "/v3/mail/send") {
      const body = await request.json();
      if (
        !body.from?.email ||
        !Array.isArray(body.personalizations) ||
        !body.personalizations.every(
          (item) =>
            Array.isArray(item.to) &&
            item.to.length &&
            item.to.every((to) => typeof to.email === "string"),
        ) ||
        !Array.isArray(body.content)
      )
        return Response.json(
          { errors: [{ message: "invalid payload" }] },
          { status: 400 },
        );
      return new Response(null, {
        status: 202,
        headers: { "x-message-id": crypto.randomUUID() },
      });
    }
    return new Response(null, { status: 502 });
  },
};
