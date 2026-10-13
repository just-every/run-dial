import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { auditor, keyboardActivate, trackPage } from "./audit.mjs";
import { resetOverviewFixture, seedOverviewRecords } from "../part1-host/native-fixture.mjs";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { holdOverviewReads, loadingOverview, overviewCards, overviewPaths, overviewReads } from "./overview-readiness.mjs";
import { overviewSynchronizationRegression } from "./overview-sync-regression.mjs";
import { completeEmptyWorkspace } from "./first-run-fixture.mjs";

const evidencePhase = process.env.DIAL_PART1_HOST_PHASE ?? "run";

export async function operatorJourney(browser, origin, scans, errors) {
  let storageState;
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ locale: "de-DE", timezoneId: "America/New_York", viewport: { width, height: width === 390 ? 844 : 1024 } });
    try {
      const page = await context.newPage(); trackPage(page, errors);
      const audit = auditor(page, width, scans);
      await page.goto(origin + "/signin");
      // Native details are already usable in SSR; audit and mutate them after hydration.
      await page.locator('main[data-signin-ready="true"]').waitFor();
      await audit("signin");
      await keyboardActivate(page, page.getByText("Set up the first operator", { exact: true }));
      assert.ok(await page.getByLabel("Setup token", { exact: true }).isVisible());
      await audit("signin-setup");
    } finally { await context.close(); }
  }

  // Both responsive cold-state audits must finish before the one native claim
  // changes this shared database. A new browser context does not reset D1.
  const bootstrap = await browser.newContext();
  const input = { token: "dial-test-only-setup-token-at-least-32", displayName: "Axe owner", returnTo: "/setup" };
  try {
    const response = await bootstrap.request.post(origin + "/auth/bootstrap", { data: input, headers: { Origin: origin }, maxRedirects: 0 });
    assert.equal(response.status(), 303, "native bootstrap succeeds");
    assert.ok(response.headers()["set-cookie"], "native bootstrap issues its session cookie");
    storageState = await bootstrap.storageState();
    assert.ok(storageState.cookies.some(cookie => cookie.name === "operator_session_local" && cookie.httpOnly), "the native HttpOnly session is retained");
    const eventsResponse = await bootstrap.request.get(origin + "/api/app/event-types");
    assert.equal(eventsResponse.status(), 200);
    assert.deepEqual(await eventsResponse.json(), [], "preview begins with genuinely empty D1, without development samples");
  } finally { await bootstrap.close(); }

  // Observe the fresh native setup before legitimately finishing it. The later
  // empty overview covers a completed workspace whose event has been removed.
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState, viewport: { width, height: width === 390 ? 844 : 1024 } });
    try {
      const page = await context.newPage(); trackPage(page, errors);
      await page.goto(origin + "/app");
      await page.waitForURL(origin + "/setup");
      await page.getByRole("list", { name: "First-run checklist", exact: true }).waitFor();
      assert.equal(await page.getByText("0 bookings", { exact: true }).count(), 0, "unfinished owners cannot render the app overview");
      assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false, `${width}px first-run checklist has no horizontal overflow`);
      await page.getByRole("link", { name: "Profile", exact: true }).click();
      await page.waitForURL(origin + "/setup/profile");
      await page.getByRole("button", { name: "Save profile", exact: true }).waitFor();
      assert.equal(await page.getByLabel("Name", { exact: true }).inputValue(), "", "fresh setup exposes the real empty profile editor");
    } finally { await context.close(); }
  }
  const setup = await browser.newContext({ storageState });
  try { await completeEmptyWorkspace(setup, origin); } finally { await setup.close(); }

  for (const width of [1440, 390]) {
    const anonymous = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1024 } });
    try {
      const page = await anonymous.newPage(); trackPage(page, errors);
      await page.goto(origin + "/signin");
      for (const reload of [false, true]) {
        if (reload) await page.reload();
        await page.locator('main[data-signin-ready="true"]').waitFor();
        assert.equal(await page.getByText("Set up the first operator", { exact: true }).count(), 0, "claimed setup is absent in a fresh sessionless context and after reload");
        assert.equal(await page.locator('form[action="/auth/bootstrap"], input[name="token"]').count(), 0);
      }
      const replay = await anonymous.request.post(origin + "/auth/bootstrap", { data: input, headers: { Origin: origin }, maxRedirects: 0 });
      assert.equal(replay.status(), 409, "a claimed installation refuses repeat bootstrap");
      assert.equal(replay.headers()["set-cookie"], undefined, "replay grants no session");
      assert.equal((await anonymous.request.get(origin + "/api/app/session")).status(), 401);
      assert.deepEqual(await anonymous.cookies(), [], "claimed setup checks stay sessionless");
    } finally { await anonymous.close(); }
    const context = await browser.newContext({ locale: "de-DE", timezoneId: "America/New_York", storageState, viewport: { width, height: width === 390 ? 844 : 1024 } });
    try {
      const page = await context.newPage(); trackPage(page, errors);
      const audit = auditor(page, width, scans);
      const emptyReads = overviewReads(page);
      await Promise.all([page.goto(origin + "/app", { timeout: emptyReads.remaining() }), emptyReads.requests, emptyReads.responses]);
      await page.getByText("No event types are configured yet.", { exact: true }).waitFor({ timeout: emptyReads.remaining() }).catch(async error => { throw new Error(`${error.message}\n${page.url()}\n${await page.locator("body").innerText()}`); });
      await page.getByText("0 bookings", { exact: true }).waitFor({ timeout: emptyReads.remaining() });
      await page.getByText("0 requests", { exact: true }).waitFor({ timeout: emptyReads.remaining() });
      assert.ok(await page.getByText("There are no booking records to review.", { exact: true }).isVisible());
      assert.ok(await page.getByText("There are no request records to review.", { exact: true }).isVisible());
      assert.equal(await page.getByText("Host profile not configured", { exact: true }).count(), 0, "the completed workspace retains its saved profile");
      assert.equal((await (await page.request.get(origin + "/api/app/profile")).json()).name, "Axe Host");
      await audit("empty-app");
      await page.goto(origin + "/app/settings");
      const summary = page.getByText("Set up Google Calendar for this installation", { exact: true });
      await summary.waitFor();
      await keyboardActivate(page, summary);
      await page.getByText(origin + "/api/calendar/oauth/callback", { exact: true }).waitFor();
      assert.ok(await page.getByText("Required Google bindings are present. Connect and check the account to verify access.", { exact: true }).isVisible());
      await page.waitForFunction(() => ["Invite operator", "Save mail preference", "Add rule"].every(label => [...globalThis.document.querySelectorAll("button")].some(button => button.textContent === label && !button.matches(":disabled"))));
      await audit("settings-google-guide");
    } finally { await context.close(); }
  }

  const reviewFailures = [];
  const owner = await browser.newContext({ locale: "de-DE", timezoneId: "America/New_York", storageState });
  try {
    const seeded = await seedOverviewRecords(owner, origin);
    const expectedBookingNames = [...seeded.bookings]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map((booking) => booking.inviteeName);
    const expectedRequestNames = [...seeded.requests]
      .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt))
      .map((request) => request.inviteeName);
    capture(reviewFailures, `seeded review fixture reports a connected calendar (${seeded.calendarState})`, seeded.calendarState === "healthy");

    for (const width of [1440, 390]) {
      const context = await browser.newContext({ locale: "de-DE", timezoneId: "America/New_York", storageState, viewport: { width, height: width === 390 ? 844 : 1024 } });
      try {
        const page = await context.newPage(); trackPage(page, errors);
        const audit = auditor(page, width, scans);
        const reads = overviewReads(page);
        const [, nativeRequests] = await Promise.all([page.goto(origin + "/app", { timeout: reads.remaining() }), reads.requests, reads.responses]);
        capture(reviewFailures, `${width}px Overview reads bookings from the native API`, nativeRequests.some(request => new URL(request.url()).pathname === overviewPaths[0]));
        capture(reviewFailures, `${width}px Overview reads requests from the native API`, nativeRequests.some(request => new URL(request.url()).pathname === overviewPaths[1]));
        const { bookingCard, requestCard } = overviewCards(page);
        await Promise.all([
          bookingCard.getByText("2 bookings", { exact: true }).waitFor({ timeout: reads.remaining() }),
          requestCard.getByText("2 requests", { exact: true }).waitFor({ timeout: reads.remaining() }),
        ]);
        await captureEvidence(page, `${evidencePhase}-overview-populated-${width}.png`);
        capture(reviewFailures, `${width}px booking count`, await bookingCard.getByText("2 bookings", { exact: true }).count() === 1);
        capture(reviewFailures, `${width}px request count`, await requestCard.getByText("2 requests", { exact: true }).count() === 1);
        capture(reviewFailures, `${width}px bookings do not show the empty message`, await bookingCard.getByText("There are no booking records to review.", { exact: true }).count() === 0);
        capture(reviewFailures, `${width}px requests do not show the empty message`, await requestCard.getByText("There are no request records to review.", { exact: true }).count() === 0);
        const bookingNames = await bookingCard.getByRole("list", { name: "Latest bookings", exact: true }).getByRole("listitem").locator("strong").allTextContents().catch(() => []);
        const requestNames = await requestCard.getByRole("list", { name: "Latest requests", exact: true }).getByRole("listitem").locator("strong").allTextContents().catch(() => []);
        capture(reviewFailures, `${width}px latest bookings are newest first`, JSON.stringify(bookingNames) === JSON.stringify(expectedBookingNames));
        capture(reviewFailures, `${width}px latest requests are newest first`, JSON.stringify(requestNames) === JSON.stringify(expectedRequestNames));
        try { await audit("overview-populated"); } catch (error) { reviewFailures.push(`${width}px populated Overview axe/overflow audit: ${error.message}`); }

        await page.route(url => new URL(url).pathname === "/api/app/calendar/calendars", route => route.fulfill({
          status: 200,
          json: { calendars: [{ id: "Calendar for the scheduling and operations team with shared external meeting room holds", accessRole: "owner", primary: true, conferenceCapable: false }] },
        }));
        await page.goto(origin + "/app/settings");
        const destination = page.locator("label").filter({ hasText: "Destination calendar" }).locator("select");
        const destinationVisible = await destination.waitFor({ timeout: 4_000 }).then(() => true, () => false);
        capture(reviewFailures, `${width}px connected Settings shows its calendar selector (${seeded.calendarState})`, destinationVisible);
        // The selector renders before its mocked calendar list resolves; wait for the option instead of counting once.
        const longOption = page.getByRole("option", { name: "Calendar for the scheduling and operations team with shared external meeting room holds (primary)", exact: true });
        await longOption.first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => undefined);
        capture(reviewFailures, `${width}px connected Settings shows its long calendar option`, await longOption.count() === 1);
        await captureEvidence(page, `${evidencePhase}-settings-connected-${width}.png`);
        if (!destinationVisible) reviewFailures.push(`${width}px Settings page after connection setup: ${(await page.locator("body").innerText()).slice(0, 600)}`);
        try { await audit("settings-connected"); } catch (error) { reviewFailures.push(`${width}px connected Settings axe/overflow audit: ${error.message}`); }
      } finally { await context.close(); }
    }

    const loadingContext = await browser.newContext({ locale: "de-DE", timezoneId: "America/New_York", storageState, viewport: { width: 390, height: 844 } });
    try {
      const page = await loadingContext.newPage(); trackPage(page, errors);
      await loadingOverview(page, origin);
    } finally { await loadingContext.close(); }

    await overviewSynchronizationRegression(browser, origin, storageState, errors);

    const failedContext = await browser.newContext({ locale: "de-DE", timezoneId: "America/New_York", storageState, viewport: { width: 390, height: 844 } });
    const mockedFailures = new Map([["/api/app/bookings", 0], ["/api/app/availability-requests", 0]]);
    let heldFailures;
    try {
      const page = await failedContext.newPage(); trackPage(page, errors);
      page.on("response", response => {
        const path = new URL(response.url()).pathname;
        if (response.status() === 503 && mockedFailures.has(path)) mockedFailures.set(path, mockedFailures.get(path) + 1);
      });
      heldFailures = await holdOverviewReads(page, [...mockedFailures.keys()], route => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
      const failedReads = overviewReads(page, { status: 503 });
      await Promise.all([page.goto(origin + "/app", { timeout: failedReads.remaining() }), failedReads.requests]);
      await Promise.race([heldFailures.intercepted, failedReads.responses]);
      const { bookingCard, requestCard } = overviewCards(page);
      // Navigation and SSR cards are ready before these responses are delivered.
      // Exercise that boundary explicitly instead of depending on hydration speed.
      await Promise.all([
        bookingCard.getByText("Loading bookings…", { exact: true }).waitFor({ timeout: failedReads.remaining() }),
        requestCard.getByText("Loading requests…", { exact: true }).waitFor({ timeout: failedReads.remaining() }),
      ]);
      assert.deepEqual(Object.fromEntries(mockedFailures), { "/api/app/bookings": 0, "/api/app/availability-requests": 0 }, "pending native responses have not yet produced the intended failures");
      heldFailures.release();
      await failedReads.responses;
      await Promise.all([
        bookingCard.getByText("Bookings could not be loaded.", { exact: true }).waitFor({ timeout: failedReads.remaining() }),
        requestCard.getByText("Requests could not be loaded.", { exact: true }).waitFor({ timeout: failedReads.remaining() }),
      ]);
      capture(reviewFailures, "390px failed booking response has an explicit error state", await bookingCard.getByText("Bookings could not be loaded.", { exact: true }).count() === 1);
      capture(reviewFailures, "390px failed request response has an explicit error state", await requestCard.getByText("Requests could not be loaded.", { exact: true }).count() === 1);
      capture(reviewFailures, "390px failed booking load does not show an empty state", await bookingCard.getByText("There are no booking records to review.", { exact: true }).count() === 0);
      capture(reviewFailures, "390px failed request load does not show an empty state", await requestCard.getByText("There are no request records to review.", { exact: true }).count() === 0);
      capture(reviewFailures, "390px failed booking load does not claim zero bookings", !(await bookingCard.innerText()).match(/\b0 bookings?\b/));
      capture(reviewFailures, "390px failed request load does not claim zero requests", !(await requestCard.innerText()).match(/\b0 requests?\b/));
      assert.deepEqual(Object.fromEntries(mockedFailures), { "/api/app/bookings": 1, "/api/app/availability-requests": 1 }, "both explicit error states came from the two intended native API failures");
    } finally { try { await heldFailures?.close(); } finally { await failedContext.close(); } }
    const mocked503Message = "Failed to load resource: the server responded with a status of 503 (Service Unavailable)";
    const mocked503Errors = errors.filter(error => error.message === mocked503Message);
    assert.equal(mocked503Errors.length, 2, "only the two intentional 503 responses are expected to appear as browser console errors");
    let removedMocked503Errors = 0;
    for (let index = errors.length - 1; index >= 0 && removedMocked503Errors < 2; index -= 1) {
      if (errors[index].message === mocked503Message) { errors.splice(index, 1); removedMocked503Errors += 1; }
    }
    assert.equal(removedMocked503Errors, 2, "the two route-verified mocked failures are accounted for without suppressing other browser errors");
  } finally {
    try { await resetOverviewFixture(owner, origin); } finally { await owner.close(); }
  }
  assert.deepEqual(reviewFailures, [], reviewFailures.join("\n"));
  return storageState;
}

function capture(failures, check, passed) {
  if (!passed) failures.push(check);
}

async function captureEvidence(page, filename) {
  await writeFile(evidencePath(filename), await page.screenshot({ fullPage: true, caret: "initial" }));
}
