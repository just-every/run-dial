import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { auditor, keyboardActivate, trackPage } from "./audit.mjs";
import { resetOverviewFixture, seedOverviewRecords } from "../part1-host/native-fixture.mjs";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { overviewCards } from "./overview-readiness.mjs";
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
    assert.ok(storageState.cookies.some(cookie => cookie.name.startsWith("operator_session_local_") && cookie.httpOnly), "the native HttpOnly session is retained");
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
      await page.goto(origin + "/app");
      await page.getByText("No event types are configured yet.", { exact: true }).waitFor({ timeout: 30_000 }).catch(async error => { throw new Error(`${error.message}\n${page.url()}\n${await page.locator("body").innerText()}`); });
      await page.getByText("0 bookings", { exact: true }).waitFor({ timeout: 30_000 });
      await page.getByText("0 requests", { exact: true }).waitFor({ timeout: 30_000 });
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
        const documentResponse = await page.goto(origin + "/app");
        const html = await documentResponse.text();
        for (const name of [...expectedBookingNames, ...expectedRequestNames]) assert.ok(html.includes(name), "native SSR includes each populated activity record");
        const { bookingCard, requestCard } = overviewCards(page);
        await Promise.all([
          bookingCard.getByText("2 bookings", { exact: true }).waitFor({ timeout: 30_000 }),
          requestCard.getByText("2 requests", { exact: true }).waitFor({ timeout: 30_000 }),
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

    await overviewSynchronizationRegression(browser, origin, storageState, errors);
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
