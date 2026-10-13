import assert from "node:assert/strict";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { auditor, trackPage } from "../tests/booking-axe/audit.mjs";
import { completeEmptyWorkspace } from "../tests/booking-axe/first-run-fixture.mjs";
import { bookingJourney } from "../tests/booking-axe/booking.mjs";
import { publicSiteJourney } from "../tests/booking-axe/public-site.mjs";
import { avatarBoundaryEvidence } from "../tests/booking-axe/acceptance-avatar-boundary.mjs";
import { filterEvidence } from "../tests/booking-axe/acceptance-filters.mjs";
import { seedAcceptanceRecords, avatarEvidence } from "../tests/booking-axe/acceptance-records.mjs";
import { keyboardControls, dismissNativeConfirmation } from "../tests/booking-axe/acceptance-keyboard.mjs";
import { capacityAudit } from "../tests/booking-axe/acceptance-capacity.mjs";
import { evidencePath } from "./evidence-path.mjs";

// One bounded acceptance pass against the maintained test Worker. No production
// route, render, or persistence is intercepted; fixtures replace only providers.
const origin = process.env.DIAL_REVIEW_ORIGIN ?? "http://127.0.0.1:15752";
const scans = [], errors = [], checks = [];
const environment = `Local workerd on ${hostname()}, headless Chromium and maintained test-only calendar/mail adapters. These results establish neither production capacity nor complete WCAG 2.2 AA conformance. No manual screen-reader testing. Manifest statuses remain unchanged.`;
const browser = await chromium.launch({ headless: true });
let owner;
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const page = await context.newPage(); trackPage(page, errors);
      await page.goto(origin + "/signin");
      await page.locator('main[data-signin-ready="true"]').waitFor();
      await auditor(page, width, scans)("acceptance-signin");
    } finally { await context.close(); }
  }
  await publicSiteJourney(browser, origin, scans, errors, [320]);
  await delay(60_000);
  owner = await browser.newContext();
  const bootstrap = await owner.request.post(origin + "/auth/bootstrap", { headers: { Origin: origin }, data: { token: "dial-test-only-setup-token-at-least-32", displayName: "Acceptance owner", returnTo: "/setup" }, maxRedirects: 0 });
  assert.equal(bootstrap.status(), 303);
  const state = await owner.storageState();
  await scanPages([ ["setup", "/setup", "First-run checklist"] ], state);
  await completeEmptyWorkspace(owner, origin);
  const seeded = await owner.request.post(origin + "/__fixtures/setup", { data: {} });
  assert.equal(seeded.status(), 200);
  const fixture = await seeded.json();
  await seedAcceptanceRecords(owner, origin, fixture);
  await avatarBoundaryEvidence(browser, owner, origin, checks);
  await avatarEvidence(browser, origin, state, scans, errors, checks);
  const filterContext = await browser.newContext({ storageState: state });
  try { const filterPage = await filterContext.newPage(); trackPage(filterPage, errors); await filterEvidence(filterPage, origin, fixture.eventId, checks); } finally { await filterContext.close(); }
  await delay(60_000);
  // The public journey creates native bookings and captures all seven public
  // flow documents, including details, receipt, manage and cancellation states.
  await bookingJourney(browser, origin, scans, errors);
  // Independent reflow journey receives the ordinary next admission window.
  await delay(60_000);
  await bookingJourney(browser, origin, scans, errors, [320]);
  await delay(60_000);
  await scanPages([
    ["bookings", "/app/bookings", "Bookings"],
    ["booking-record", "/app/bookings", "Bookings"],
    ["event-record", `/app/event-types/${fixture.eventId}`, "A focused introduction"],
    ["requests", "/app/requests", "Requests"],
    ["event-types", "/app/event-types", "Event types"],
    ["profile", "/app/profile", "Profile"],
    ["settings", "/app/settings", "Settings"],
  ], state);
  if (!process.env.DIAL_BROWSER_ONLY) await capacityAudit(owner, origin, fixture, checks);
  assert.deepEqual(errors, []);
} catch (error) {
  checks.push({ check: "audit completion", passed: false, error: error.message });
  throw error;
} finally {
  await writeFile(evidencePath("acceptance-audit.json"), JSON.stringify({ scans, checks, errors, environment }, null, 2));
  const lines = ["# Bounded Dial acceptance audit", "", environment, "", "Command: `DIAL_ACCEPTANCE_AUDIT=1 DIAL_EVIDENCE_DIR=<external evidence folder> nice -n 15 node --test --test-concurrency=1 tests/booking-axe.test.mjs`", "", ...scans.map(scan => `- ${scan.violations.some(item => ["serious", "critical"].includes(item.impact)) || scan.overflow.document > scan.overflow.viewport + 1 ? "FAIL" : "PASS"}: ${scan.stage} at ${scan.width}px; serious/critical ${scan.violations.filter(item => ["serious", "critical"].includes(item.impact)).length}; screenshot ${scan.screenshot}`), ...checks.map(check => `- ${check.passed ? "PASS" : "FAIL"}: ${check.check}; ${JSON.stringify(check)}`), ...errors.map(error => `- FAIL: browser ${JSON.stringify(error)}`)];
  await writeFile(evidencePath("AUDIT.md"), lines.join("\n") + "\n");
  await owner?.close(); await browser.close();
}

async function scanPages(pages, storageState) {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ storageState, viewport: { width, height: width === 1440 ? 1024 : 844 } });
    try {
      const page = await context.newPage(); trackPage(page, errors);
      for (const [name, path, heading] of pages) {
        await page.goto(origin + path);
        if (name === "setup") await page.getByRole("list", { name: heading, exact: true }).waitFor();
        else await page.getByRole("heading", { name: heading, exact: true }).waitFor();
        await page.waitForFunction(() => !globalThis.document.body.innerText.includes("Loading "));
        if (name === "booking-record") {
          await page.getByRole("button").filter({ hasText: "Acceptance record invitee" }).click();
          await page.getByRole("heading", { name: "Acceptance record invitee", exact: true }).waitFor();
          await page.getByText("Saved value: DISCOVERY-42", { exact: true }).waitFor();
        }
        if (name === "settings") {
          await page.getByRole("heading", { name: "Custom fields", exact: true }).waitFor();
          await page.getByRole("textbox", { name: "Field label", exact: true }).fill("Keyboard review field");
          await page.getByRole("combobox", { name: "Field type" }).selectOption("single_choice");
          await keyboardControls(page, [["Record type", page.getByRole("combobox", { name: "Record type" })], ["Field label", page.getByRole("textbox", { name: "Field label", exact: true })], ["Field type", page.getByRole("combobox", { name: "Field type" })], ["Choices (one per line)", page.getByRole("textbox", { name: "Choices (one per line)", exact: true })]].concat([["Add custom field", page.getByRole("button", { name: "Add custom field", exact: true })]]), "custom-field-settings", width, checks);
          await dismissNativeConfirmation(page, page.getByRole("button", { name: "Delete Internal reference", exact: true }), "custom field deletion", checks);
        }
        if (name === "booking-record" || name === "event-record" || name === "requests") {
          await page.getByRole("textbox", { name: "Internal reference", exact: true }).fill("Keyboard edit preview");
          await page.getByRole("textbox", { name: "Operator context", exact: true }).fill("Keyboard context preview");
          await page.getByRole("combobox", { name: "Follow-up priority" }).selectOption("Normal");
          await page.getByRole("checkbox", { name: "Review complete", exact: true }).uncheck();
          const controls = [["Internal reference", page.getByRole("textbox", { name: "Internal reference", exact: true })], ["Operator context", page.getByRole("textbox", { name: "Operator context", exact: true })], ["Follow-up priority", page.getByRole("combobox", { name: "Follow-up priority" })], ["Review complete", page.getByRole("checkbox", { name: "Review complete", exact: true })]].flatMap(([label, control]) => [[label, control], [`Save ${label}`, page.getByRole("button", { name: `Save ${label}`, exact: true })], [`Clear ${label}`, page.getByRole("button", { name: `Clear ${label}`, exact: true })]]);
          await keyboardControls(page, controls, `custom-field-${name}`, width, checks);
          await page.getByRole("textbox", { name: "Internal reference", exact: true }).fill("DISCOVERY-42");
          await page.getByRole("textbox", { name: "Operator context", exact: true }).fill("A private note for follow-up.\nReview the proposed scope before our next conversation.");
          await page.getByRole("combobox", { name: "Follow-up priority" }).selectOption("High");
          await page.getByRole("checkbox", { name: "Review complete", exact: true }).check();
        }
        if (name === "bookings") {
          await page.getByRole("searchbox", { name: "Search invitee name or email", exact: true }).fill("Acceptance");
          await keyboardControls(page, [["Search invitee name or email", page.getByRole("searchbox", { name: "Search invitee name or email", exact: true })], ...["Lifecycle state", "Start time", "Event type", "External delivery"].map(label => [label, page.getByRole("combobox", { name: label })]), ...["From date (UTC)", "Through date (UTC)"].map(label => [label, page.getByLabel(label, { exact: true })])].concat([["Clear filters", page.getByRole("button", { name: "Clear filters", exact: true })]]), "booking-filters", width, checks);
        }
        await auditor(page, width, scans)(`acceptance-${name}`);
      }
    } finally { await context.close(); }
  }
}
