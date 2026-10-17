import { completeEmptyWorkspace } from "../tests/booking-axe/first-run-fixture.mjs";
import { bookingJourney } from "../tests/booking-axe/booking.mjs";
import { timezoneJourney } from "../tests/booking-axe/timezone.mjs";
import { keyboardJourney } from "../tests/booking-axe/keyboard.mjs";
import { dayPickerJourney } from "../tests/booking-axe/day-picker.mjs";
import { requestOnlyJourney } from "../tests/booking-axe/request-only.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { operatorJourney } from "../tests/booking-axe/operator.mjs";
import { publicSiteAudits, publicSiteJourney } from "../tests/booking-axe/public-site.mjs";
import { evidencePath } from "./evidence-path.mjs";
const origin = process.env.DIAL_REVIEW_ORIGIN ?? "http://127.0.0.1:15752";
const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
const scans = [], errors = [], keyboardChecks = [];
let storageState;
try {
  if (process.env.DIAL_KEYBOARD_ONLY) {
    const owner = await browser.newContext();
    try {
      const response = await owner.request.post(origin + "/auth/bootstrap", { data: { token: "dial-test-only-setup-token-at-least-32", displayName: "Keyboard owner", returnTo: "/setup" }, headers: { Origin: origin }, maxRedirects: 0 });
      assert.equal(response.status(), 303);
      await completeEmptyWorkspace(owner, origin);
      storageState = await owner.storageState();
    } finally { await owner.close(); }
  } else if (process.env.DIAL_PICKER_ONLY) { await dayPickerJourney(browser, origin, scans, errors); } else if (process.env.DIAL_INVITEE_ONLY) {
    assert.equal((await fetch(origin + "/__fixtures/setup", { method: "POST" })).status, 200);
    await dayPickerJourney(browser, origin, scans, errors);
    await timezoneJourney(browser, origin, errors);
    await bookingJourney(browser, origin, scans, errors);
  } else {
  const signInHtml = await (await fetch(origin + "/signin")).text();
  assert.doesNotMatch(signInHtml, /<input\b[^>]*\sstyle=/, "unmodified sign-in SSR inputs have no inline style before axe");
  assert.doesNotMatch(signInHtml, /<details\b[^>]*\sopen(?:[\s=>])/, "unmodified sign-in SSR setup is closed before hydration");
  // Before any journey creates a host profile, so the Lobby is still unclaimed.
  await publicSiteJourney(browser, origin, scans, errors);
  // Every journey shares the loopback client's native public budget (120 requests a minute). Without a pause the Lobby
  // and docs audits fall in the same minute as the booking journey, whose confirm is then refused with 429.
  console.log("Waiting one native admission minute after the public-site journey.");
  await delay(60_000);
  storageState = await operatorJourney(browser, origin, scans, errors);
  await requestOnlyJourney(browser, origin, scans, errors, storageState);
  await dayPickerJourney(browser, origin, scans, errors);
  assert.equal((await fetch(origin + "/__fixtures/setup", { method: "POST" })).status, 200);
  await timezoneJourney(browser, origin, errors);
  await bookingJourney(browser, origin, scans, errors);
  }
  if (!process.env.DIAL_PICKER_ONLY) {
    // Prior journeys have closed their contexts, but share D1 and the loopback
    // client with this independent keyboard journey. Let the native 60-second
    // request and booking-mutation windows elapse; the hourly alternative limit remains.
    if (!process.env.DIAL_KEYBOARD_ONLY) console.log("Waiting one native admission minute before the independent keyboard journey.");
    if (!process.env.DIAL_KEYBOARD_ONLY) await delay(60_000);
    await keyboardJourney(browser, origin, errors, storageState, keyboardChecks);
    assert.deepEqual(keyboardChecks.filter(check => check.passed === false), [], "Every keyboard outcome passes");
  }
  assert.deepEqual(errors, []);
  const audited = scans.filter(scan => "violations" in scan).length;
  assert.equal(audited, process.env.DIAL_KEYBOARD_ONLY ? 0 : process.env.DIAL_PICKER_ONLY ? 4 : process.env.DIAL_INVITEE_ONLY ? 28 : 52 + publicSiteAudits, "every expected desktop and mobile document receives its axe audit");
  const journey = process.env.DIAL_KEYBOARD_ONLY ? "focused operator and public keyboard journey at 1440 and 390; no axe scan or screen-reader conformance claim" : process.env.DIAL_PICKER_ONLY ? "day-first picker with 24-hour and 9-to-5 availability at 1440×900 and 390×844; exact native ranking, slot union, first viewport and height checks included" : process.env.DIAL_INVITEE_ONLY ? "focused public picker/timezone/history/booking/reschedule/keyboard diagnosis; operator/request matrix requires the full52 gate" : "unclaimed Lobby and every docs page, with browser storage left empty; hydrated home/profile/event/details/confirmation/manage with shared picker, request compose/review/receipt, sign-in, empty app and expanded Google setup at 1440 and 390; keyboard and overflow checks included";
  console.log(audited ? `${audited} full-document axe scans; zero serious or critical violations; ${journey}.` : `${journey}.`);
} finally {
  await writeFile(evidencePath("booking-axe.json"), JSON.stringify({ scans, errors, keyboardChecks, scope: "Headless Chromium; production hydrated UI with test-only provider fixtures; no live Google" }, null, 2));
  await browser.close();
}
