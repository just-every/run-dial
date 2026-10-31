import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import { contract } from "./contract.mjs";
import { bookingRuntime } from "./move-in/booking-runtime.mjs";

const migrations = fileURLToPath(new URL("../migrations/core/", import.meta.url));
const update = "0081_your_hours.sql";
const base = { description: "A focused conversation about the next product decision.", color: "#176b5a", listed: true, alternativeRequestsEnabled: true, slotIncrementMinutes: 15, minimumNoticeMinutes: 240, bookingHorizonDays: 60, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [] };
const windows = (days, startMinute, endMinute) => days.map(weekday => ({ weekday, startMinute, endMinute }));
// The demo's three event types as main seeds them: each with weekly hours of its own.
const demo = [
  { ...base, slug: "product-kickoff", title: "Product kickoff", durationMinutes: 30, locationType: "fixed_link", locationLabel: "Video call", locationValue: "https://meet.example.test/kickoff", availability: windows([1, 2, 3, 4, 5], 540, 1020) },
  { ...base, slug: "roadmap-review", title: "Roadmap review", durationMinutes: 60, locationType: "in_person", locationLabel: "In person", locationValue: "Level 2, 88 Ann Street, Brisbane", minimumNoticeMinutes: 1440, afterBufferMinutes: 15, availability: windows([2, 4], 600, 960) },
  { ...base, slug: "office-hours", title: "Office hours", durationMinutes: 15, locationType: "phone", locationLabel: "Phone call", locationValue: "+61 7 3000 0000", alternativeRequestsEnabled: false, minimumNoticeMinutes: 60, availability: windows([5], 780, 960) },
];
// A full Monday-to-Sunday host week a fortnight ahead: past any notice, inside every horizon.
function sampleWeek() {
  const day = new Date(Date.now() + 14 * 86_400_000);
  day.setUTCDate(day.getUTCDate() + (8 - day.getUTCDay()) % 7);
  return day.toISOString().slice(0, 10);
}
const plus = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A ready single-host workspace (profile, mail and calendar checked) whose only events are the ones each case makes. */
async function workspace(options) {
  const runtime = await bookingRuntime(options);
  const setup = await runtime.data("/__fixtures/setup", {});
  await runtime.api(`/api/app/event-types/${setup.eventId}`, { method: "DELETE" });
  const slots = async (slug, week) => (await runtime.data(`/api/public/book/dial-host/${slug}/availability?week=${week}`)).slots.map(slot => slot.startAt);
  const publish = async input => { const event = await runtime.data("/api/app/event-types", input, 201); await runtime.data(`/api/app/event-types/${event.id}/publish`, {}); return event; };
  return { runtime, slots, publish };
}

contract("AVAIL-011", "an install at main's schema with the demo's three events takes the update: the kickoff's hours become yours and every event offers the same week", async () => {
  const week = sampleWeek(), main = await mkdtemp(join(tmpdir(), "dial-your-hours-main-"));
  let before, after;
  try {
    await mkdir(join(main, "core"));
    // Isolate the hours migration while retaining the later additive fields
    // today's native fixture needs. Before the update every event still uses
    // its own weekly windows; the migration alone changes that ownership.
    for (const name of (await readdir(migrations)).filter(name => name.endsWith(".sql") && name !== update)) await copyFile(join(migrations, name), join(main, "core", name));
    // The same events on a current install, before anything uses your hours, give the week each offered before the update.
    before = await workspace();
    for (const input of demo) await before.publish(input);
    const offered = Object.fromEntries(await Promise.all(demo.map(async ({ slug }) => [slug, await before.slots(slug, week)])));
    for (const list of Object.values(offered)) assert.ok(list.length > 0);

    after = await workspace({ migrationsRoot: main });
    const events = [];
    for (const input of demo) events.push(await after.publish(input));
    await after.runtime.db.batch(splitSqlQuery(await readFile(join(migrations, update), "utf8")).map(sql => after.runtime.db.prepare(sql)));

    const hours = await after.runtime.data("/api/app/hours");
    assert.deepEqual(hours.yours.windows.map(({ weekday, startMinute, endMinute }) => [weekday, startMinute, endMinute]), demo[0].availability.map(({ weekday, startMinute, endMinute }) => [weekday, startMinute, endMinute]));
    assert.deepEqual(hours.events.map(({ id, uses }) => [id, uses]), events.map((event, index) => [event.id, index === 0 ? "yours" : "own"]));
    assert.deepEqual(hours.others, []);
    for (const { slug } of demo) assert.deepEqual(await after.slots(slug, week), offered[slug], `${slug} offers the same week`);
  } finally {
    await before?.runtime.close(); await after?.runtime.close();
    await rm(main, { recursive: true, force: true });
  }
});

contract(["AVAIL-011", "EVENT-006"], "time off added once to your hours closes those days on every event, its own hours included, and a new event without hours uses yours", async () => {
  const week = sampleWeek(), friday = plus(week, 4);
  const { runtime, slots, publish } = await workspace();
  try {
    const kickoff = { ...demo[0], availability: undefined };
    const onYours = await publish(kickoff);
    const office = await publish(demo[2]);
    const hours = await runtime.data("/api/app/hours");
    assert.deepEqual(hours.events.map(({ id, uses }) => [id, uses]), [[onYours.id, "yours"], [office.id, "own"]]);
    const open = { [kickoff.slug]: await slots(kickoff.slug, week), [demo[2].slug]: await slots(demo[2].slug, week) };

    const { id, windows: yours, blockUsHolidays, reopenedHolidays } = hours.yours;
    await runtime.data(`/api/app/availability-schedules/${id}`, { name: "Your hours", windows: yours, blockUsHolidays, reopenedHolidays, timeOff: [{ startDate: friday, endDate: friday }] }, 200, "PUT");
    for (const [slug, offered] of Object.entries(open)) {
      const closed = await slots(slug, week);
      const onFriday = startAt => new Date(startAt).toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" }) === friday;
      assert.ok(offered.some(onFriday), `${slug} was open on ${friday}`);
      assert.deepEqual(closed, offered.filter(startAt => !onFriday(startAt)), `${slug} keeps every other day and loses ${friday}`);
    }
  } finally { await runtime.close(); }
});
