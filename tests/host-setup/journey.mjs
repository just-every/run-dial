import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { clipboardJourney, securityJourney } from "./sharing.mjs";
import { activityJourney } from "./activity.mjs";
import { overviewHealth } from "./health.mjs";
import { deletedEventRecovery } from "./readiness.mjs";
import { calendarOptionalJourney } from "./calendar-optional.mjs";
import { localSignIn } from "./local-signin.mjs";
import { keyboardFocus } from "../booking-axe/audit.mjs";

const safeRequestPath = url => new URL(url).pathname.replace(/(\/(?:manage|review|alternative-time)\/)[^/]+/g, "$1[redacted]");

export async function hostJourneys(origin, scenario) {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--use-mock-keychain", "--password-store=basic", "--no-sandbox"] });
  let scans = 0;
  try {
    {
      const { width, requestsOnly, calendarOptional } = scenario;
      assert.equal((await fetch(origin + "/__host/reset", { method: "POST" })).status, 204);
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: "de-DE", timezoneId: "America/New_York", permissions: ["clipboard-read", "clipboard-write"] });
      const page = await context.newPage();
      const errors = [];
      let step = "public landing";
      const requestSteps = new WeakMap();
      const startedAt = Date.now();
      const observe = surface => {
        surface.on("request", request => requestSteps.set(request, `${step} at ${Date.now() - startedAt}ms`));
        surface.on("pageerror", () => errors.push("Uncaught browser error"));
        surface.on("console", message => {
          if (message.type() === "error" && !/^Failed to load resource: the server responded with a status of 503/.test(message.text())) errors.push(`Browser console error during ${step} at ${message.location().url ? safeRequestPath(message.location().url) : "unknown source"}: ` + message.text().replace(/([?&#](?:token|state|nonce|key)=)[^\s&"<>]+/gi, "$1[redacted]"));
          if (/hydration|hydrating|did not match/i.test(message.text())) errors.push("Hydration diagnostic");
        });
        surface.on("response", response => {
          if (response.status() >= 400 && !(response.status() === 503 && new URL(response.url()).pathname.endsWith("/copy-report"))) errors.push(`Unexpected browser HTTP ${response.status()} ${response.request().method()} ${safeRequestPath(response.url())} (requested during ${requestSteps.get(response.request())}; response during ${step} at ${Date.now() - startedAt}ms)`);
        });
      };
      observe(page); context.on("page", observe);
      const scan = async name => {
        const results = await new AxeBuilder({ page }).analyze();
        assert.deepEqual(results.violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id), [], name);
        assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false, name + " overflow");
        await page.evaluate(() => globalThis.scrollTo(0, 0));
        await page.screenshot({ path: evidencePath(`host-${calendarOptional ? "calendar-optional" : requestsOnly ? "requests" : "published"}-${width}-${name}.png`), fullPage: true, caret: "initial" }); scans++;
      };
      try {
        await page.goto(origin + "/"); assert.equal(await page.locator('a[href^="/book/"]').count(), 0);
        step = "bootstrap"; await page.goto(origin + "/signin");
        // The native details control can open in SSR HTML before React owns it.
        await page.locator('main[data-signin-ready="true"]').waitFor();
        await expect(page.getByLabel("Email address", { exact: true })).toBeEnabled();
        await page.getByText("Set up the first operator", { exact: true }).click();
        await page.getByLabel("Your name", { exact: true }).fill("Fresh owner");
        await page.getByLabel("Setup token", { exact: true }).fill("dial-test-only-setup-token-at-least-32");
        await page.getByRole("button", { name: "Complete setup", exact: true }).click(); await page.waitForURL(origin + "/setup");
        await expect(page.getByRole("list", { name: "First-run checklist" })).toBeVisible();
        assert.equal(await (await page.request.get(origin + "/api/app/profile")).json(), null);
        assert.deepEqual(await (await page.request.get(origin + "/api/app/event-types")).json(), []);
        for (const path of ["/api/app/bookings", "/api/app/availability-requests"]) {
          const response = await page.request.get(origin + path);
          assert.equal(response.status(), 200, `${path} remains callable during first run`);
          assert.deepEqual(await response.json(), [], "fresh native activity lists are empty");
        }
        assert.equal((await (await page.request.get(origin + "/api/app/host-setup")).json()).completedAt, null);
        step = "fresh setup"; await overviewHealth(page, origin, { calendar: "disconnected", mail: "unchecked" }); await scan("fresh");
        step = "private redirect and reload"; await page.goto(origin + "/app/bookings"); await page.waitForURL(origin + "/setup"); await page.reload(); await expect(page.getByRole("list", { name: "First-run checklist" })).toBeVisible();
        step = "sign out"; await page.getByRole("button", { name: "Sign out", exact: true }).filter({ visible: true }).click(); await page.waitForURL(origin + "/signin");
        // Native local outbox/Confirm flow; never persist a capability URL or screenshot it.
        step = "native sign in"; await localSignIn(page, origin);
        step = "profile editor";
        await page.getByRole("link", { name: "Host profile", exact: true }).click();
        await page.getByLabel("Name", { exact: true }).fill("Fresh Host"); await page.getByLabel("Title", { exact: true }).fill("Advisor"); await page.getByLabel("Public handle", { exact: true }).fill("fresh-host"); await page.getByRole("combobox", { name: "Host timezone", exact: true }).fill("UTC"); await page.getByRole("option", { name: "UTC", exact: true }).click(); await page.getByLabel("Biography", { exact: true }).fill("An independently configured host."); await page.getByRole("button", { name: "Save profile", exact: true }).click(); await expect(page.getByRole("button", { name: "Save profile", exact: true })).toBeEnabled();
        step = "connection settings"; await page.goto(origin + "/setup/settings#mail-connection"); await page.getByRole("button", { name: "Check sender", exact: true }).click(); await expect(page.getByText("Mail sender verified.", { exact: true })).toBeVisible();
        if (!requestsOnly && !calendarOptional) {
          await page.getByRole("button", { name: "Connect Google Calendar", exact: true }).click();
          await expect(page.getByRole("combobox", { name: "Destination calendar", exact: true })).toBeVisible();
          await page.getByRole("combobox", { name: "Destination calendar", exact: true }).selectOption("synthetic-calendar"); await page.getByRole("checkbox", { name: "synthetic-calendar (primary) owner", exact: true }).check();
          await page.getByRole("button", { name: "Save calendar selection", exact: true }).click(); await expect(page.getByText("Calendar selection saved. Check the connection to verify it.", { exact: true })).toBeVisible();
          await page.getByRole("button", { name: "Check connection", exact: true }).click(); await expect(page.getByText("Calendar check passed.", { exact: true })).toBeVisible(); await scan("connected-settings");
        }
        await page.goto(origin + "/setup"); await expect(page.locator('[data-step="mail"]')).toContainText("Done"); if (requestsOnly) { await expect(page.locator('[data-step="calendar"]')).toContainText("Optional"); await overviewHealth(page, origin, { calendar: "disconnected", mail: "healthy" }); await scan("mail-without-calendar"); }
        step = "new event steps"; await page.getByRole("link", { name: "New event type", exact: true }).first().click();
        await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        assert.equal(await page.getByLabel("Name", { exact: true }).evaluate(node => node.validity.valueMissing), true);
        assert.deepEqual(await (await page.request.get(origin + "/api/app/event-types")).json(), [], "invalid new event creates nothing");
        await page.getByLabel("Name", { exact: true }).fill("First event");
        assert.equal(await page.getByLabel("Description", { exact: true }).evaluate(node => node.required), false, "new event description is optional");
        if (!requestsOnly) await page.getByLabel("Description", { exact: true }).fill("A useful first meeting.");
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        await page.getByRole("button", { name: "30 min", exact: true }).click();
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        await page.getByRole("combobox", { name: "Location kind", exact: true }).selectOption("phone");
        await page.getByLabel("Private link, number, or address", { exact: true }).fill("+1 202 555 0100");
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        await expect(page.getByRole("radio", { name: /^Your hours/ })).toBeChecked();
        await scan("event-form");
        await expect(page.getByRole("button", { name: "Create", exact: true })).toBeEnabled();
        await page.getByRole("radio", { name: /^Its own hours/ }).check();
        const weeklyFields = page.locator("[data-step-fields]");
        await weeklyFields.getByRole("combobox", { name: "Day", exact: true }).selectOption("1");
        const windowTimes = weeklyFields.locator('input[type="time"]');
        await expect(windowTimes).toHaveCount(2);
        await windowTimes.first().fill("10:15");
        const firstWindowTimes = await windowTimes.evaluateAll(inputs => inputs.map(input => input.value));
        await weeklyFields.getByRole("button", { name: /^Add / }).click();
        const removeWindows = weeklyFields.getByRole("button", { name: /^Remove / });
        await expect(removeWindows).toHaveCount(2);
        const removeNames = await removeWindows.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")));
        assert.equal(removeNames.every(name => typeof name === "string" && name.length > 0), true);
        assert.equal(new Set(removeNames).size, 2, "each window has a distinct accessible removal action");
        const secondRemove = weeklyFields.getByRole("button", { name: removeNames[1], exact: true });
        const createButton = page.getByRole("button", { name: "Create", exact: true });
        await keyboardFocus(page, createButton);
        await expect(createButton).toBeFocused();
        await keyboardFocus(page, secondRemove);
        await expect(secondRemove).toBeFocused();
        await expect(page.locator(".dial-tooltip:popover-open")).toBeVisible();
        await expect(page.locator(".dial-tooltip:popover-open")).toHaveText(removeNames[1]);
        await page.keyboard.press("Enter");
        await expect(removeWindows).toHaveCount(1);
        assert.deepEqual(await windowTimes.evaluateAll(inputs => inputs.map(input => input.value)), firstWindowTimes, "removing the second window preserves the first window's times");
        await page.getByRole("radio", { name: /^Your hours/ }).check();
        await expect(page.getByRole("radio", { name: /^Your hours/ })).toBeChecked();
        const createdResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/app/event-types" && response.request().method() === "POST");
        await page.getByRole("button", { name: "Create", exact: true }).click();
        const created = await createdResponse; assert.equal(created.status(), 201); const draft = await created.json();
        assert.equal(draft.status, "draft"); if (requestsOnly) assert.equal(draft.description, "", "optional description stays empty on Create"); assert.equal(draft.durationMinutes, 30); assert.equal(draft.slotIncrementMinutes, 15);
        assert.equal(draft.minimumNoticeMinutes, 240); assert.equal(draft.bookingHorizonDays, 60);
        assert.equal(draft.beforeBufferMinutes, 0); assert.equal(draft.afterBufferMinutes, 0); assert.equal(draft.hostDayBookingLimit, null);
        await page.waitForURL(origin + `/setup/event-types/${draft.id}`);
        // The existing editor still requires a description when its details are changed.
        if (requestsOnly) await page.getByLabel("Description", { exact: true }).fill("A useful first meeting.");
        // Questions and advanced controls remain on the saved event, after the short creation flow.
        const more = page.locator("details").filter({ has: page.locator("summary", { hasText: "More options" }) }); await expect(more).not.toHaveAttribute("open");
        await page.getByRole("combobox", { name: "Question 1 type", exact: true }).selectOption("text");
        await page.getByRole("textbox", { name: "Question 1 label", exact: true }).fill("Meeting goals");
        await page.getByRole("checkbox", { name: "Question 1 is required", exact: true }).uncheck();
        await more.locator("summary").click(); await expect(more.getByLabel("Slug", { exact: true })).toHaveValue("first-event");
        for (const label of ["Minimum notice", "Booking horizon (days)", "Before buffer (minutes)", "After buffer (minutes)", "Host-day cap (optional)", "Colour"]) await expect(more.getByLabel(label, { exact: true })).toBeEnabled();
        await expect(more.getByRole("combobox", { name: "Start increment", exact: true })).toBeEnabled(); await more.locator("summary").click();
        const savedDetails = page.waitForResponse(response => new URL(response.url()).pathname === `/api/app/event-types/${draft.id}/details` && response.request().method() === "PATCH");
        await page.getByRole("button", { name: "Save changes", exact: true }).click();
        assert.equal((await savedDetails).status(), 200);
        await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
        await page.getByRole("link", { name: "Edit recurring availability →", exact: true }).click();
        await expect(page.getByRole("button", { name: "Save recurring availability", exact: true })).toBeVisible();
        // The first event starts on your hours, whose holidays and time off are set on this page.
        const hours = await (await page.request.get(origin + "/api/app/hours")).json();
        assert.equal(hours.events.find(event => event.id === new URL(page.url()).pathname.split("/").at(-2)).uses, "yours"); assert.ok(hours.yours);
        await expect(page.getByRole("checkbox", { name: "Block US federal holidays and observed dates", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Add time off", exact: true })).toBeVisible();
        if (!requestsOnly) { const closed = page.locator("div.rounded-2xl").filter({ has: page.getByText("Unavailable", { exact: true }) }); for (let day = 0; day < 7 && await closed.count(); day++) await closed.first().getByRole("button", { name: "Add window", exact: true }).click(); }
        else { const remove = page.getByRole("button", { name: /^Remove \w+ window \d+$/ }); for (let left = 20; left && await remove.count(); left--) await remove.first().click(); }
        const [availabilityResponse] = await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname === `/api/app/event-types/${draft.id}/availability` && response.request().method() === "PUT"),
          page.getByRole("button", { name: "Save recurring availability", exact: true }).click(),
        ]);
        assert.equal(availabilityResponse.status(), 200);
        await page.waitForURL(/\/setup\/event-types\/[A-Z0-9]{26}$/);
        const eventId = new URL(page.url()).pathname.split("/").at(-1);
        const publish = page.getByRole("button", { name: "Publish event type", exact: true });
        if (requestsOnly) { await expect(publish).toBeDisabled(); await expect(page.getByRole("link", { name: "Add at least one open availability window.", exact: true })).toBeVisible(); }
        await page.getByRole("button", { name: requestsOnly ? "Open requests" : "Publish event type", exact: true }).click();
        await expect(page.getByRole("link", { name: "Embed on your website", exact: true })).toBeVisible();
        step = "security probes"; await securityJourney(page, origin, eventId);
        step = "deleted event recovery"; await deletedEventRecovery(browser, context, origin, eventId, requestsOnly);
        step = "clipboard and embeds"; await clipboardJourney({ browser, page, context, origin, eventId, requestsOnly, scan });
        step = "completed setup"; await page.goto(origin + "/setup");
        const state = await (await page.request.get(origin + "/api/app/host-setup")).json(); assert.equal(state.steps.find(step => step.id === "copy").done, true);
        if (requestsOnly) { await page.getByText(/Booking configuration/).click(); await expect(page.locator('[data-step="calendar"]')).toContainText("Optional"); await expect(page.locator('[data-step="availability"]')).toContainText("To do"); }
        else { assert.ok(state.steps.every(step => step.done), "published host completes every returned setup step"); await expect(page.getByRole("list", { name: "Booking configuration" })).toBeHidden(); step = "activity"; if (calendarOptional) await calendarOptionalJourney(browser, page, origin, eventId, width, scan); else await activityJourney(page, origin, eventId, scan); }
        await scan("complete"); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
    console.log(`${scans} host setup axe scans; ${scenario.requestsOnly ? "requests-only" : "published"} journey at ${scenario.width}px.`);
  } finally { await browser.close(); }
}
