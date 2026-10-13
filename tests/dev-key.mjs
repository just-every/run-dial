// Test rigs run the real Worker with a fixed local key, the way `rer setup` gives a checkout its own: the development
// outbox answers only a caller that presents it. A header suits fetch clients; a browser trades it once for the gate cookie.
export const TEST_DEV_KEY = "dial-test-only-dev-key-abcdef0123456789abcdef0123456789";
export const devKeyHeaders = { "x-rer-dev-key": TEST_DEV_KEY };

/** Opens the gate for a browser context the way the page behind RER_OPEN does: one same-origin POST that sets its cookie. */
export async function openGate(context, origin) {
  const response = await context.request.post(origin + "/__dev/key", { headers: { origin, "content-type": "application/json" }, data: { key: TEST_DEV_KEY } });
  if (response.status() !== 204) throw new Error(`The dev key exchange answered HTTP ${response.status()}.`);
}

/** The same exchange for a checkout's own key, read from the fragment of the RER_OPEN link that `rer dev`, `rer preview` or `rer outbox` printed. */
export async function openGateFromLink(context, openUrl) {
  const link = new URL(openUrl), key = new URLSearchParams(link.hash.slice(1)).get("rer-dev");
  if (!key) throw new Error("The RER_OPEN link carries no key.");
  const response = await context.request.post(`${link.origin}/__dev/key`, { headers: { origin: link.origin, "content-type": "application/json" }, data: { key } });
  if (response.status() !== 204) throw new Error(`The dev key exchange answered HTTP ${response.status()}.`);
}
