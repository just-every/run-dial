import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

export async function filterEvidence(page, origin, eventId, checks) {
  const search = page.getByLabel("Search invitee name or email", { exact: true });
  const settled = async () => { await page.getByText("Loading bookings…", { exact: true }).waitFor({ state: "hidden" }); };
  await page.goto(origin + "/app/bookings"); await search.waitFor(); await settled();
  await search.pressSequentially("Acceptance record", { delay: 45 });
  await page.waitForFunction(() => new URL(globalThis.location.href).searchParams.get("query") === "Acceptance record");
  await page.getByRole("heading", { name: "Acceptance record invitee", exact: true }).waitFor();
  checks.push({ check: "Typed multiword search preserves intermediate spaces and finds native booking", passed: true });
  for (const literal of ["false", "null", "123", '{"tag":"value"}', "[1,2]"]) {
    await page.goto(origin + "/app/bookings?" + new URLSearchParams({ query: literal })); await search.waitFor(); await settled();
    assert.equal(await search.inputValue(), literal);
    await page.reload(); await search.waitFor(); await settled(); assert.equal(await search.inputValue(), literal);
    checks.push({ check: `JSON-shaped query ${literal}: direct navigation and reload retain literal value`, passed: true });
  }
  await page.goto(origin + "/app/bookings?query=Acceptance"); await search.waitFor(); await settled();
  await page.goto(origin + "/app/bookings?query=NoSuchInvitee"); await search.waitFor(); await settled();
  await page.goBack(); await search.waitFor(); await settled(); assert.equal(await search.inputValue(), "Acceptance");
  await page.goForward(); await search.waitFor(); await settled(); assert.equal(await search.inputValue(), "NoSuchInvitee");
  checks.push({ check: "Booking query browser back/forward restores URL and control state", passed: true });
  const from = new Date().toISOString().slice(0, 10), to = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const combined = { state: "confirmed", time: "future", eventTypeId: eventId, from, to, deliveryFailed: "false", query: "Acceptance record", page: "9999" };
  const combinedRequest = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === "/api/app/bookings" && url.searchParams.get("query") === combined.query && url.searchParams.get("offset") === "0";
  });
  await page.goto(origin + "/app/bookings?" + new URLSearchParams(combined)); await search.waitFor();
  await page.waitForFunction(() => !new URL(globalThis.location.href).searchParams.has("page")); await settled();
  for (const [key, value] of Object.entries(combined).filter(([key]) => key !== "page")) {
    const encoded = new URL(page.url()).searchParams.get(key);
    // Router serialization may JSON-quote a string that resembles JSON; the
    // workspace decodes that string before deriving its native route query.
    const decoded = encoded?.startsWith('"') ? JSON.parse(encoded) : encoded;
    assert.equal(decoded, value);
  }
  const native = new URL((await combinedRequest).url()).searchParams;
  for (const [key, value] of Object.entries(combined).filter(([key]) => key !== "page")) {
    assert.equal(native.get(key), key === "from" ? `${value}T00:00:00.000Z` : key === "to" ? `${value}T23:59:59.999Z` : value);
  }
  assert.equal(await page.getByRole("combobox", { name: "External delivery" }).inputValue(), "clear");
  await page.getByRole("heading", { name: "Acceptance record invitee", exact: true }).waitFor();
  await page.reload(); await search.waitFor(); await settled(); assert.equal(await search.inputValue(), combined.query);
  checks.push({ check: "All seven URL filters combine; out-of-range page clamps without losing filters; reload restores native record", passed: true });
  await page.goto(origin + "/app/bookings"); await search.waitFor(); await settled();
  let release, received;
  const held = new Promise(resolve => { release = resolve; });
  const intercepted = new Promise(resolve => { received = resolve; });
  const matcher = url => url.pathname === "/api/app/bookings" && url.searchParams.get("query") === "Acceptance";
  await page.route(matcher, async route => {
    const response = await route.fetch(); received(); await held;
    await route.fulfill({ response });
  });
  try {
    await search.fill("Acceptance"); await intercepted;
    await search.fill("NoSuchInvitee");
    await page.getByRole("heading", { name: "No bookings match these filters", exact: true }).waitFor();
    release(); await delay(500);
    assert.equal(await search.inputValue(), "NoSuchInvitee");
    assert.equal(await page.getByRole("heading", { name: "Acceptance record invitee", exact: true }).count(), 0);
    assert.ok(await page.getByRole("heading", { name: "No bookings match these filters", exact: true }).isVisible());
    checks.push({ check: "Stale-body fence rejects delayed real native response after newer query completes", passed: true, transport: "Held original route.fetch response; no invented application response" });
  } finally { release(); await page.unroute(matcher); }
}
