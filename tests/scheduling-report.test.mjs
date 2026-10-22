import assert from "node:assert/strict";
import { contract } from "./contract.mjs";
import { bookingRuntime } from "./move-in/booking-runtime.mjs";

// REPORT-001 on a seeded month (tests/review/report-month.ts): March 2026 for a host in America/New_York, whose clocks
// moved forward on 8 March. Every number below is a hand count of that fixture, written here and not computed by the product.
contract("REPORT-001", "each scheduling tile matches a hand count of a seeded month and its drill-through lists exactly the counted bookings", async () => {
  const runtime = await bookingRuntime();
  try {
    const setup = await runtime.data("/__fixtures/setup", {});
    const profile = await runtime.data("/api/app/profile");
    await runtime.data("/api/app/profile", { handle: profile.handle, name: profile.name, title: profile.title, biography: profile.biography, timezone: "America/New_York", focusAreas: profile.focusAreas.map(({ label }) => ({ label })), socialProof: profile.socialProof.map(({ quote, attribution }) => ({ quote, attribution })) }, 200, "PATCH");
    const intro = await runtime.data(`/api/app/event-types/${setup.eventId}`);
    const deep = await runtime.data("/api/app/event-types", { slug: "deep-dive", title: "Deep dive", description: "A long working session.", durationMinutes: 60, color: "#176b5a", locationType: "fixed_link", locationLabel: "Video room", locationValue: "https://meet.example.test/room", listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 60, minimumNoticeMinutes: 0, bookingHorizonDays: 90, beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: [] }, 201);
    const operator = (await runtime.db.prepare("SELECT id FROM operators LIMIT 1").first()).id;
    await runtime.data("/__fixtures/report-month", { operatorId: operator, events: { intro: { id: intro.id, slug: intro.slug, title: intro.title }, deep: { id: deep.id, slug: deep.slug, title: deep.title } } });

    const period = { fromDate: "2026-03-01", throughDate: "2026-03-31" };
    const report = async (extra = {}) => runtime.data(`/api/app/reports/scheduling?${new URLSearchParams({ ...period, ...extra })}`);
    const tiles = async extra => Object.fromEntries((await report(extra)).tiles.map(tile => [tile.key, tile]));
    const figures = tile => Object.fromEntries(tile.figures.map(figure => [figure.key, figure.value]));
    const rows = (tile, group) => Object.fromEntries(tile.groups.find(entry => entry.title === group).rows.map(row => [row.label, row.count]));
    const march = await tiles();

    assert.equal((await report()).period.timezone, "America/New_York");
    // Bookings created: 19 created in March (Kim and Lou were created in February); Max was imported and counts by its source creation time.
    assert.deepEqual([march.created.count, march.created.imported], [19, 1]);
    // Rescheduled: Eli and Tom moved inside March (Tom twice, three moves in all); Uma moved in April.
    assert.deepEqual([march.rescheduled.count, figures(march.rescheduled).reschedules], [2, 3]);
    // Canceled in March: Dee, Nia, Oz and Pam; Quin canceled on 2 April.
    assert.equal(march.cancelled.count, 4);
    assert.deepEqual(rows(march.cancelled, "Reasons"), { "Plans changed": 2, "Found another provider": 1, "No reason given": 1 });
    // Attendance: 13 bookings started in March and were not canceled. Attended 6, no-show 2, not marked 5; rates over the 8 marked.
    assert.deepEqual([march.attendance.count, march.attendance.imported], [13, 1]);
    assert.deepEqual(figures(march.attendance), { attended: 6, no_show: 2, unmarked: 5, attendance_rate: 75, no_show_rate: 25 });
    // Lead time of the 19 created in March: hours 12, 20.5, 24, 28, 29, 35.5, 48, 48, 68, 126, 168, 168, 170, 340, 474.5, 497.5, 497.5, 504, 508 (sum 3766.5, median the tenth, 126).
    assert.equal(march.lead_time.count, 19);
    assert.deepEqual(figures(march.lead_time), { average_hours: 198.2, median_hours: 126 });
    assert.deepEqual(rows(march.lead_time, "Lead time"), { "Under 1 day": 2, "1 to under 3 days": 7, "3 to under 7 days": 1, "7 days or more": 9 });
    // Popular days and hours on the New York wall clock. Hal and Ivy start late on 30 and 31 March New York time, which are
    // 31 March and 1 April in UTC; Fay at 07:30 UTC is 03:30 after the clocks moved, where a fixed -5 offset would say 02:30.
    assert.equal(march.popular_days.count, 13);
    assert.deepEqual(rows(march.popular_days, "Weekday"), { Monday: 2, Tuesday: 4, Wednesday: 2, Thursday: 1, Friday: 1, Sunday: 3 });
    assert.deepEqual(rows(march.popular_hours, "Starting hour"), { "00:00": 1, "01:00": 1, "03:00": 1, "10:00": 2, "11:00": 4, "12:00": 2, "23:00": 2 });
    // UTM and source values (LINK-003) of the 19 created in March; ten arrived with none.
    assert.deepEqual(rows(march.source, "UTM source"), { newsletter: 4, partner: 3 });
    assert.deepEqual(rows(march.source, "UTM medium"), { email: 2 });
    assert.deepEqual(rows(march.source, "UTM campaign"), { spring: 1 });
    assert.deepEqual(rows(march.source, "Source"), { homepage: 4 });
    assert.equal(figures(march.source).untagged, 10);
    // Chosen duration (EVENT-011): three 60-minute bookings (Eli, Ivy, Rae) and sixteen of 30 minutes.
    assert.deepEqual(rows(march.duration, "Length"), { "30 minutes": 16, "60 minutes": 3 });
    // Revenue: Rae paid $90.00 and Sue $50.00 inside March.
    assert.deepEqual([march.revenue.count, figures(march.revenue).revenue], [2, 14000]);
    for (const tile of Object.values(march)) assert.ok(tile.definition.length > 40, `${tile.key} states its definition`);

    // One event type: the 60-minute Deep dive has Eli, Ivy and Rae.
    const only = await tiles({ eventTypeId: deep.id });
    assert.deepEqual([only.created.count, only.rescheduled.count, only.cancelled.count, only.attendance.count, figures(only.attendance).attendance_rate, figures(only.revenue).revenue], [3, 1, 0, 3, 100, 9000]);

    // Drill-through: the bookings list opens on exactly the counted bookings.
    const names = async query => {
      const response = await runtime.api(`/api/app/bookings?${new URLSearchParams({ ...query, limit: "100" })}`);
      assert.equal(response.status, 200);
      const list = await response.json();
      assert.equal(Number(response.headers.get("X-Total-Count")), list.length);
      return list.map(booking => booking.inviteeName).sort();
    };
    const drill = (report, bucket, extra = {}) => names({ report, periodFrom: period.fromDate, periodThrough: period.throughDate, ...(bucket ? { bucket } : {}), ...extra });
    assert.deepEqual(await drill("created"), ["Ada", "Bea", "Cy", "Dee", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jo", "Max", "Nia", "Oz", "Pam", "Quin", "Rae", "Sue", "Tom", "Uma"]);
    assert.deepEqual(await drill("rescheduled"), ["Eli", "Tom"]);
    assert.deepEqual(await drill("cancelled"), ["Dee", "Nia", "Oz", "Pam"]);
    assert.deepEqual(await drill("cancelled", "reason:Plans changed"), ["Dee", "Nia"]);
    assert.deepEqual(await drill("cancelled", "reason:"), ["Pam"]);
    assert.deepEqual(await drill("attendance", "no_show"), ["Bea", "Sue"]);
    assert.deepEqual(await drill("attendance", "unmarked"), ["Eli", "Hal", "Ivy", "Max", "Tom"]);
    assert.deepEqual(await drill("lead_time", "lead:lt1d"), ["Dee", "Gus"]);
    assert.deepEqual(await drill("popular_days", "weekday:2"), ["Bea", "Cy", "Ivy", "Rae"]);
    assert.deepEqual(await drill("popular_days", "weekday:0"), ["Fay", "Gus", "Kim"]);
    assert.deepEqual(await drill("popular_hours", "hour:3"), ["Fay"]);
    assert.deepEqual(await drill("popular_hours", "hour:23"), ["Hal", "Ivy"]);
    assert.deepEqual(await drill("source", "utm_source:newsletter"), ["Ada", "Bea", "Gus", "Rae"]);
    assert.deepEqual(await drill("source", "source:homepage"), ["Ada", "Cy", "Fay", "Nia"]);
    assert.deepEqual(await drill("source", "untagged"), ["Dee", "Hal", "Ivy", "Jo", "Max", "Pam", "Quin", "Sue", "Tom", "Uma"]);
    assert.deepEqual(await drill("duration", "duration:60"), ["Eli", "Ivy", "Rae"]);
    assert.deepEqual(await drill("revenue"), ["Rae", "Sue"]);
    assert.deepEqual(await drill("created", undefined, { eventTypeId: deep.id }), ["Eli", "Ivy", "Rae"]);
    assert.equal((await drill("popular_days", "weekday:6")).length, 0, "a bucket nothing counts lists no booking");

    // A period with no booking reports zero everywhere; a bad period or an anonymous call is refused.
    const quiet = await tiles({ fromDate: "2025-01-01", throughDate: "2025-01-31" });
    assert.ok(Object.values(quiet).every(tile => tile.count === 0));
    assert.equal((await runtime.api(`/api/app/reports/scheduling?fromDate=2026-03-31&throughDate=2026-03-01`)).status, 400);
    assert.equal((await runtime.api(`/api/app/reports/scheduling?${new URLSearchParams(period)}`, { headers: { cookie: "" } })).status, 401);
    assert.equal((await runtime.api(`/api/app/bookings?report=created`)).status, 400, "a drill-through names its period");
  } finally {
    await runtime.close();
  }
});
