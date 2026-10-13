import assert from "node:assert/strict";

export const overviewPaths = ["/api/app/bookings", "/api/app/availability-requests"];
const nativeGet = (request, path) => request.method() === "GET" && new URL(request.url()).pathname === path;

export function overviewReads(page, { paths = overviewPaths, status = 200, timeout = 30_000 } = {}) {
  const deadline = performance.now() + timeout;
  const remaining = () => Math.max(1, Math.ceil(deadline - performance.now()));
  const requests = Promise.all(paths.map(path => page.waitForRequest(request => nativeGet(request, path), { timeout: remaining() })));
  const responses = Promise.all(paths.map(async path => {
    const response = await page.waitForResponse(response => nativeGet(response.request(), path), { timeout: remaining() });
    assert.equal(response.status(), status, `Overview GET ${path} returns the expected native status`);
    return response;
  }));
  // Both observers are armed before navigation. A navigation/DOM failure may
  // leave either observer pending until context cleanup; observe rejections now
  // while preserving the original rejecting promises for the caller to await.
  requests.catch(() => {});
  responses.catch(() => {});
  return { requests, responses, remaining };
}

export async function holdOverviewReads(page, paths, respond = route => route.continue()) {
  const held = Promise.withResolvers();
  const intercepted = Promise.withResolvers();
  const reached = new Set();
  await page.route(url => paths.includes(url.pathname), async route => {
    if (route.request().method() !== "GET") return route.continue();
    reached.add(new URL(route.request().url()).pathname);
    if (paths.every(path => reached.has(path))) intercepted.resolve();
    await held.promise;
    await respond(route);
  });
  return {
    intercepted: intercepted.promise,
    release: held.resolve,
    async close() {
      held.resolve();
      // Release before draining: waiting for a held handler first deadlocks.
      await page.unrouteAll({ behavior: "wait" });
    },
  };
}

export function overviewCards(page) {
  return {
    bookingCard: page.getByRole("heading", { name: "Bookings", exact: true }).locator("xpath=ancestor::section[1]"),
    requestCard: page.getByRole("heading", { name: "Alternative requests", exact: true }).locator("xpath=ancestor::section[1]"),
  };
}

export async function loadingOverview(page, origin) {
  const held = await holdOverviewReads(page, [overviewPaths[0]]);
  const reads = overviewReads(page, { paths: [overviewPaths[0]] });
  try {
    await Promise.all([page.goto(origin + "/app", { timeout: reads.remaining() }), reads.requests]);
    // A request event precedes its route callback. Observe interception too;
    // the response observer supplies the same bounded deadline if it never runs.
    await Promise.race([held.intercepted, reads.responses]);
    const { bookingCard } = overviewCards(page);
    await bookingCard.getByText("Loading bookings…", { exact: true }).waitFor({ timeout: reads.remaining() });
    assert.equal(await bookingCard.getByText("Loading bookings…", { exact: true }).count(), 1, "390px bookings stay in a loading state while the native response is pending");
    assert.equal(await bookingCard.getByText("There are no booking records to review.", { exact: true }).count(), 0, "390px loading bookings do not show a false empty state");
    assert.doesNotMatch(await bookingCard.innerText(), /\b0 bookings?\b/, "390px loading bookings do not claim zero bookings");
    held.release();
    const [response] = await reads.responses;
    await bookingCard.getByText("2 bookings", { exact: true }).waitFor({ timeout: reads.remaining() });
    return response;
  } finally { await held.close(); }
}
