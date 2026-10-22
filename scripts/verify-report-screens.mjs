import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { completeEmptyWorkspace } from "../tests/booking-axe/first-run-fixture.mjs";
import { screenRecorder, screenshotFolder, widths } from "./screens-support.mjs";

// REPORT-001 browser proof on the review rig: the scheduling report populated, empty, failed and signed out, and the
// bookings list a tile opens, at 1440 and 390 pixels with axe. Run with DIAL_REPORT_SCREENS set to the evidence folder.
const origin = process.env.DIAL_REVIEW_ORIGIN ?? "http://127.0.0.1:15752", folder = await screenshotFolder("DIAL_REPORT_SCREENS"), headers = { Origin: origin };
const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
const owner = await browser.newContext();
try {
  assert.equal((await owner.request.post(origin + "/auth/bootstrap", { headers, data: { token: "dial-test-only-setup-token-at-least-32", displayName: "Morgan Bell", returnTo: "/setup" }, maxRedirects: 0 })).status(), 303);
  await completeEmptyWorkspace(owner, origin);
  const setup = await (await owner.request.post(origin + "/__fixtures/setup", { headers, data: {} })).json();
  const profile = await (await owner.request.get(origin + "/api/app/profile")).json();
  assert.equal((await owner.request.patch(origin + "/api/app/profile", { headers, data: { handle: profile.handle, name: profile.name, title: profile.title, biography: profile.biography, timezone: "America/New_York", focusAreas: profile.focusAreas.map(({ label }) => ({ label })), socialProof: [] } })).status(), 200);
  const intro = await (await owner.request.get(`${origin}/api/app/event-types/${setup.eventId}`)).json();
  const created = await owner.request.post(origin + "/api/app/event-types", { headers, data: { slug: "deep-dive", title: "Deep dive", description: "A long working session.", durationMinutes: 60, color: "#176b5a", locationType: "fixed_link", locationLabel: "Video room", locationValue: "https://meet.example.test/room", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: [] } });
  assert.equal(created.status(), 201);
  const deep = await created.json(), operator = (await (await owner.request.get(origin + "/api/app/operators")).json()).operators[0].id;
  assert.equal((await owner.request.post(origin + "/__fixtures/report-month", { headers, data: { operatorId: operator, events: { intro: { id: intro.id, slug: intro.slug, title: intro.title }, deep: { id: deep.id, slug: deep.slug, title: deep.title } } } })).status(), 200);
  const { capture, shots } = screenRecorder({ browser, origin, folder, storageState: await owner.storageState() });
  const march = "from=2026-03-01&to=2026-03-31";
  for (const width of widths) {
    await capture(width, "report-populated", `/app/bookings?view=report&${march}`, async page => { await page.getByRole("heading", { name: "Bookings created" }).waitFor(); await page.locator('[data-tile-count="created"]').getByText("19").waitFor(); await page.getByRole("region", { name: "Figures not available yet" }).waitFor(); });
    await capture(width, "report-one-event-type", `/app/bookings?view=report&${march}&eventTypeId=${deep.id}`, async page => { await page.locator('[data-tile-count="created"]').getByText("3", { exact: true }).waitFor(); });
    await capture(width, "report-empty", "/app/bookings?view=report&from=2025-01-01&to=2025-01-31", async page => { await page.getByText("No bookings in this period").waitFor(); });
    await capture(width, "report-failed", `/app/bookings?view=report&${march}`, async page => { await page.getByRole("alert").getByText("could not", { exact: false }).waitFor(); }, { setup: page => page.route("**/api/app/reports/scheduling**", route => route.abort()) });
    await capture(width, "report-signed-out", `/app/bookings?view=report&${march}`, async page => { await page.waitForURL(/\/signin/); }, { session: false });
    await capture(width, "report-drill-through", `/app/bookings?report=popular_days&bucket=weekday%3A2&periodFrom=2026-03-01&periodThrough=2026-03-31`, async page => { await page.getByText("Counted by", { exact: false }).waitFor(); await page.getByText("Showing 1–4 of 4 matching bookings").waitFor(); });
  }
  console.log(`REPORT-001 browser proof: ${shots.length} screenshots (${shots.join(", ")}).`);
} finally { await owner.close(); await browser.close(); }
