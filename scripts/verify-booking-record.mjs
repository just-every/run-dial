import { calendarScreens } from "../tests/booking-axe/calendar.mjs";
import { pollScreens } from "../tests/booking-axe/polls.mjs";
import { noticeSettingsJourney } from '../tests/booking-axe/notice-settings.mjs';
import assert from "node:assert/strict";
import { confirmationSettingsJourney } from "../tests/booking-axe/confirmation-settings.mjs";
import { chromium } from "@playwright/test";
import { completeEmptyWorkspace } from "../tests/booking-axe/first-run-fixture.mjs";
import { seedAcceptanceRecords, bookingRecordDeliveryJourney } from "../tests/booking-axe/acceptance-records.mjs";
import { clientRecordsJourney } from "../tests/booking-axe/client-records.mjs";

const origin = process.env.DIAL_REVIEW_ORIGIN ?? "http://127.0.0.1:15752";
const browser = await chromium.launch({ headless: true, args: ["--use-mock-keychain", "--password-store=basic"] });
const owner = await browser.newContext();
const scans = [], errors = [];
try {
  const admitted = await owner.request.post(origin + "/auth/bootstrap", { headers: { Origin: origin }, data: { token: "dial-test-only-setup-token-at-least-32", displayName: "Morgan Bell", returnTo: "/setup" }, maxRedirects: 0 });
  assert.equal(admitted.status(), 303);
  await completeEmptyWorkspace(owner, origin);
  const response = await owner.request.post(origin + "/__fixtures/setup", { data: {} });
  assert.equal(response.status(), 200);
  const fixture = await response.json();
  const { booking } = await seedAcceptanceRecords(owner, origin, fixture);
  await bookingRecordDeliveryJourney(browser, owner, origin, booking, scans, errors);
  await clientRecordsJourney(browser, owner, origin, fixture, scans, errors);
  await pollScreens(browser, owner, origin, scans, errors);
  await confirmationSettingsJourney(browser, owner, origin, fixture.eventId, scans, errors);
  await noticeSettingsJourney(browser,owner,origin);
  await calendarScreens(browser, owner, origin, fixture, booking, scans, errors);
  assert.deepEqual(errors, []);
  console.log(`OPER-004: ${scans.length} desktop/mobile axe scans; answers, annotations, both zones, history, independent queued/sent/failed emails and UI recovery passed.`);
} finally { await owner.close(); await browser.close(); }
