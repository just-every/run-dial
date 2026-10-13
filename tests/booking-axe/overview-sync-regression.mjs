import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { trackPage } from "./audit.mjs";
import { holdOverviewReads, loadingOverview, overviewCards, overviewPaths, overviewReads } from "./overview-readiness.mjs";

// Defer issuance, not a response: the application's original fetch still makes
// the real HTTP request after release. No data or rendered DOM is substituted.
async function deferBookingFetch(page) {
  await page.addInitScript(() => {
    const originalFetch = globalThis.fetch;
    const gate = Promise.withResolvers();
    globalThis.overviewReadGate = { release: gate.resolve, pending: false };
    globalThis.fetch = async (...args) => {
      const input = args[0];
      const url = new URL(input instanceof globalThis.Request ? input.url : input, globalThis.location.href);
      if (url.pathname === "/api/app/bookings") {
        globalThis.overviewReadGate.pending = true;
        await gate.promise;
      }
      return originalFetch(...args);
    };
  });
}

export async function overviewSynchronizationRegression(browser, origin, storageState, errors) {
  const results = [];
  const unhandled = [];
  const onUnhandled = error => unhandled.push(error.message);
  process.on("unhandledRejection", onUnhandled);
  try {
    const delayed = await browser.newContext({ storageState, viewport: { width: 390, height: 844 } });
    let loading, delayedPage;
    try {
      const page = delayedPage = await delayed.newPage(); trackPage(page, errors);
      await deferBookingFetch(page);
      const issued = [];
      page.on("request", request => { if (request.method() === "GET" && new URL(request.url()).pathname === overviewPaths[0]) issued.push(performance.now()); });
      loading = loadingOverview(page, origin);
      loading.catch(() => {});
      await page.waitForFunction(() => globalThis.overviewReadGate?.pending && globalThis.document.readyState === "complete");
      const navigationReady = performance.now();
      // Deliberately exceed the former one-second race after navigation has
      // finished, rather than assuming how long hydration happens to take.
      await pause(1_250);
      assert.equal(issued.length, 0, "delayed loading regression has not issued the native booking GET");
      await page.evaluate(() => globalThis.overviewReadGate.release());
      const response = await loading;
      assert.equal(issued.length, 1, "the delayed loading branch issues exactly one real booking GET");
      assert.ok(issued[0] - navigationReady > 1_000, "native request issuance occurs beyond the former one-second window");
      assert.equal(response.headers()["x-total-count"], "2", "the delayed original fetch reaches the native count API");
      assert.equal((await response.json()).length, 2, "the delayed original fetch returns the two native fixture records");
      results.push({ case: "loading-delayed-issuance", issuedAfterNavigationReadyMs: issued[0] - navigationReady, nativeStatus: response.status(), nativeTotal: response.headers()["x-total-count"], requests: issued.length });
    } finally {
      // Let the original fetch finish and the helper drain its owned routes
      // before closing the page, including when an earlier assertion failed.
      try { await delayedPage?.evaluate(() => globalThis.overviewReadGate?.release()); }
      catch { /* navigation may already have failed or closed the page */ }
      try { await Promise.allSettled([loading]); } finally { await delayed.close(); }
    }

    const missing = await browser.newContext({ storageState, viewport: { width: 390, height: 844 } });
    try {
      const page = await missing.newPage(); trackPage(page, errors);
      await deferBookingFetch(page);
      let issued = 0;
      page.on("request", request => { if (request.method() === "GET" && new URL(request.url()).pathname === overviewPaths[0]) issued += 1; });
      await page.goto(origin + "/app");
      await page.waitForFunction(() => globalThis.overviewReadGate?.pending && globalThis.document.readyState === "complete");
      // Start a short deadline only after the native page is ready and its
      // fetch is deliberately held. This tests deadline failure, not speed.
      const absent = overviewReads(page, { paths: [overviewPaths[0]], timeout: 100 });
      await assert.rejects(absent.requests, /waitForRequest: Timeout/, "an actual native page that never issues its GET must fail the request deadline");
      await assert.rejects(absent.responses, /waitForResponse: Timeout/);
      assert.equal(issued, 0, "no HTTP request was mistaken for readiness");
      const resumed = overviewReads(page, { paths: [overviewPaths[0]] });
      await page.evaluate(() => globalThis.overviewReadGate.release());
      await resumed.requests;
      const [response] = await resumed.responses;
      await overviewCards(page).bookingCard.getByText("2 bookings", { exact: true }).waitFor({ timeout: resumed.remaining() });
      assert.equal(issued, 1, "releasing the test gate ultimately invokes the original native fetch once");
      results.push({ case: "missing-request-deadline", requestsAtDeadline: 0, resumedNativeStatus: response.status(), resumedRequests: issued });
    } finally { await missing.close(); }

    const populated = await browser.newContext({ storageState, viewport: { width: 1440, height: 1024 } });
    let held;
    try {
      const page = await populated.newPage(); trackPage(page, errors);
      held = await holdOverviewReads(page, overviewPaths);
      const reads = overviewReads(page);
      await Promise.all([page.goto(origin + "/app", { timeout: reads.remaining() }), reads.requests]);
      await Promise.race([held.intercepted, reads.responses]);
      const { bookingCard, requestCard } = overviewCards(page);
      await Promise.all([
        bookingCard.getByText("Loading bookings…", { exact: true }).waitFor({ timeout: reads.remaining() }),
        requestCard.getByText("Loading requests…", { exact: true }).waitFor({ timeout: reads.remaining() }),
      ]);
      await pause(1_600);
      try {
        await assert.rejects(page.waitForResponse(response => new URL(response.url()).pathname === overviewPaths[0], { timeout: 100 }), /waitForResponse: Timeout/);
      } finally { await held.close(); }
      const responses = await reads.responses;
      await Promise.all([
        bookingCard.getByText("2 bookings", { exact: true }).waitFor({ timeout: reads.remaining() }),
        requestCard.getByText("2 requests", { exact: true }).waitFor({ timeout: reads.remaining() }),
      ]);
      assert.deepEqual(responses.map(response => response.status()), [200, 200], "timeout cleanup releases both held original native responses");
      assert.equal(await bookingCard.getByText("There are no booking records to review.", { exact: true }).count(), 0);
      assert.equal(await requestCard.getByText("There are no request records to review.", { exact: true }).count(), 0);
      // A fresh navigation also proves the timeout left no held route behind.
      const reloaded = overviewReads(page);
      await Promise.all([page.reload({ timeout: reloaded.remaining() }), reloaded.requests, reloaded.responses]);
      await bookingCard.getByText("2 bookings", { exact: true }).waitFor({ timeout: reloaded.remaining() });
      await requestCard.getByText("2 requests", { exact: true }).waitFor({ timeout: reloaded.remaining() });
      results.push({ case: "populated-deferred-responses-timeout-cleanup", nativeStatuses: responses.map(response => response.status()), reloadedWithoutHeldRoutes: true });
    } finally { try { await held?.close(); } finally { await populated.close(); } }
    await pause(0);
    assert.deepEqual(unhandled, [], "timed-out readiness observers and released route handlers leave no unhandled promise rejections");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await writeFile(evidencePath("overview-synchronization.json"), JSON.stringify({ results, unhandled }, null, 2));
  }
}
