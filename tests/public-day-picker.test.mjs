import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { contract } from "./contract.mjs";
const result = await build({ stdin: { contents: 'export * from "./src/core/features/public-booking/ui/day-picker-model";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
const picker = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const slot = startAt => ({ startAt, endAt: new Date(Date.parse(startAt) + 1800000).toISOString(), hostDate: "2026-11-01", hostOffset: "+00:00" });
contract("PUBLIC-001", "day grouping preserves the exact availability union and orders every date once", () => {
  const slots = [slot("2026-10-02T18:30:00Z"), slot("2026-10-02T00:15:00Z"), slot("2026-10-03T00:00:00Z")];
  for (const zone of ["Pacific/Kiritimati", "America/Los_Angeles", "Asia/Kathmandu"]) {
    const days = picker.groupSlotsByDay(slots, zone);
    assert.equal(new Set(days.map(day => day.date)).size, days.length);
    assert.deepEqual(days.map(day => day.date), [...days.map(day => day.date)].sort());
    assert.deepEqual(days.flatMap(day => day.slots).map(s => s.startAt).sort(), slots.map(s => s.startAt).sort());
  }
  assert.equal(picker.groupSlotsByDay([slots[0]], "Asia/Kathmandu")[0].date, "2026-10-03");
});
contract("AVAIL-006", "repeated DST wall clocks retain distinct offsets and instants", () => {
  const slots = [slot("2026-11-01T05:30:00Z"), slot("2026-11-01T06:30:00Z")];
  const [day] = picker.groupSlotsByDay(slots, "America/New_York");
  assert.equal(day.date, "2026-11-01"); assert.equal(day.slots.length, 2);
  const labels = slots.map(s => picker.slotTimeLabel(s.startAt, "America/New_York"));
  assert.match(labels[0], /1:30.*GMT-04:00/); assert.match(labels[1], /1:30.*GMT-05:00/);
});
contract("AVAIL-005", "host labels appear only for another zone and include differing dates", () => {
  assert.equal(picker.hostTimeLabel("2026-10-02T18:30:00Z", "UTC", "UTC"), undefined);
  assert.match(picker.hostTimeLabel("2026-10-02T18:30:00Z", "Australia/Brisbane", "UTC"), /Oct 3.*4:30.*Australia\/Brisbane/);
});
contract("PUBLIC-005", "request-only entry and composer expose no unavailable booking navigation", () => {
  const entry = readFileSync("src/core/features/public-booking/ui/request-only-page.tsx", "utf8");
  assert.match(entry, /Send another request/); assert.doesNotMatch(entry, /step=\{1\}/);
  const composer = readFileSync("src/core/features/public-booking/ui/request-page.tsx", "utf8");
  assert.match(composer, /Acknowledgement email/); assert.match(composer, /requestOnly/);
});
contract("PUBLIC-001", "public event projection exposes the stored horizon without private fields", async () => {
  const compiled = await build({ stdin: { contents: 'export {toPublicEventType} from "./src/core/features/event-types/public";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
  const { toPublicEventType } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
  const event = toPublicEventType({ slug: "session", title: "Session", description: "Talk", durationMinutes: 30, color: "green", locationLabel: "Video", alternativeRequestsEnabled: true, requestOnly: false, bookingHorizonDays: 17, locationValue: "private", ownerId: "private", questions: [] });
  assert.equal(event.bookingHorizonDays, 17);
  assert.deepEqual(Object.keys(event).sort(), ["requestOnly", "slug", "title", "description", "durationMinutes", "color", "locationLabel", "alternativeRequestsEnabled", "bookingHorizonDays", "questions"].sort());
});
contract("AVAIL-007", "the rendered picker uses native ranked reasons for only the selected day and defaults to its earliest valid date", async () => {
  const result = await build({ stdin: { contents: `import {renderToStaticMarkup} from "react-dom/server"; import {DayTimePicker} from "./src/core/features/public-booking/ui/day-time-picker"; export const render = (availability, selectedDay) => renderToStaticMarkup(<DayTimePicker availability={availability} timezone="UTC" hostTimezone="UTC" selectedDay={selectedDay} onDay={() => {}} onSelect={() => {}} />);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", banner: { js: `import {createRequire} from "node:module"; const require = createRequire(${JSON.stringify(process.cwd() + "/package.json")});` } });
  const { render } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  const early = slot("2026-11-01T09:00:00Z"), later = slot("2026-11-01T11:00:00Z"), tomorrow = slot("2026-11-02T10:00:00Z");
  const rankedSlots = [{ ...tomorrow, reason: "Inside host working day" }, { ...later, reason: "More uninterrupted free time" }, { ...early, reason: "Earliest available time" }];
  const data = { state: "available", week: "2026-11-01", slots: [tomorrow, early, later], rankedSlots, recommendations: rankedSlots.slice(0, 5) };
  const html = render(data);
  const suggestions = html.match(/aria-label="Suggested times".*?<\/section>/s)[0];
  assert.deepEqual([...suggestions.matchAll(/data-start-at="([^"]+)"/g)].map(match => match[1]), [later.startAt, early.startAt]);
  assert.ok(suggestions.indexOf("More uninterrupted free time") < suggestions.indexOf("Earliest available time"));
  assert.match(html, /data-date="2026-11-01"[^>]*aria-pressed="true"/);
  assert.doesNotMatch(html, new RegExp(`data-start-at="${tomorrow.startAt}"`));
  assert.doesNotMatch(html, /Host:/);
  const otherDay = render(data, "2026-11-02");
  assert.equal([...otherDay.matchAll(/data-start-at=/g)].length, 1); assert.match(otherDay, /Inside host working day/);
});
