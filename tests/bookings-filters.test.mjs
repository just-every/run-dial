import assert from "node:assert/strict";
import { ulid } from "ulid";
import { contract } from "./contract.mjs";
import { bookingRuntime } from "./move-in/booking-runtime.mjs";

contract(["OPER-003","REPORT-002"], "the operator booking route combines every filter and searches literal case-insensitive name and email substrings", async () => {
  const runtime = await bookingRuntime();
  try {
    const setup = await runtime.data("/__fixtures/setup", {});
    const secondEvent = await runtime.data("/api/app/event-types", {
      slug: "filter-follow-up",
      title: "Filter follow-up",
      description: "A second event type for booking filter coverage.",
      durationMinutes: 30,
      color: "#176b5a",
      locationType: "fixed_link",
      locationLabel: "Online meeting",
      locationValue: "https://dial.test/filter-meeting",
      listed: true,
      alternativeRequestsEnabled: false,
      slotIncrementMinutes: 30,
      minimumNoticeMinutes: 0,
      bookingHorizonDays: 90,
      beforeBufferMinutes: 0,
      afterBufferMinutes: 0,
      hostDayBookingLimit: null,
      questions: [],
      availability: [],
    }, 201);

    const insertBooking = async ({ eventTypeId = setup.eventId, state = "confirmed", startAt = "2030-05-15T12:00:00.000Z", name = "Needle%_*?[]Series", email = "guest@example.test", failedDelivery = true }) => {
      const id = ulid(), occurrenceId = ulid(), now = new Date().toISOString();
      await runtime.db.batch([
        runtime.db.prepare(`INSERT INTO bookings (
          id, event_type_id, event_slug, event_title, duration_minutes, location_type, location_label, location_value,
          invitee_name, invitee_email, host_timezone, invitee_timezone, state, ical_uid, calendar_state, meeting_state,
          current_occurrence_id, created_at, updated_at
        ) VALUES (?, ?, 'filter-test', 'Filter test event', 30, 'fixed_link', 'Online meeting', 'https://dial.test/filter-meeting', ?, ?, 'UTC', 'UTC', ?, ?, 'succeeded', 'not_required', NULL, ?, ?)`)
          .bind(id, eventTypeId, name, email, state, `${id}@dial-capacity.invalid`, now, now),
        runtime.db.prepare(`INSERT INTO booking_occurrences (
          id, booking_id, sequence, start_at, end_at, occupied_start_at, occupied_end_at, host_date, state, is_current, created_at
        ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, 1, ?)`)
          .bind(occurrenceId, id, startAt, new Date(Date.parse(startAt) + 30 * 60_000).toISOString(), startAt, new Date(Date.parse(startAt) + 30 * 60_000).toISOString(), startAt.slice(0, 10), state === "cancelled" ? "cancelled" : "current", now),
        runtime.db.prepare("UPDATE bookings SET current_occurrence_id = ? WHERE id = ?").bind(occurrenceId, id),
        ...(failedDelivery ? [runtime.db.prepare(`INSERT INTO delivery_outbox (
          id, kind, idempotency_key, booking_id, occurrence_id, payload_json, state, attempts, next_attempt_at, last_error_code, created_at, updated_at
        ) VALUES (?, 'mail_send', ?, ?, ?, '{}', 'failed', 1, ?, 'fixture_failure', ?, ?)`)
          .bind(ulid(), `filter-fixture:${id}`, id, occurrenceId, now, now, now)] : []),
      ]);
      return { id, startAt };
    };

    const earlier = await insertBooking({ name: "Needle%_*?[]Series earlier", email: "earlier+Needle+Mail@example.test", startAt: "2030-05-15T09:00:00.000Z" });
    const later = await insertBooking({ name: "Needle%_*?[]Series later", email: "later+Needle+Mail@example.test", startAt: "2030-05-15T12:00:00.000Z" });
    await insertBooking({ state: "cancelled" });
    const ended = await insertBooking({ startAt: "2020-05-15T12:00:00.000Z" });
    await insertBooking({ eventTypeId: secondEvent.id });
    await insertBooking({ startAt: "2030-05-14T12:00:00.000Z" });
    await insertBooking({ startAt: "2030-06-15T12:00:00.000Z" });
    const noFailedDelivery = await insertBooking({ failedDelivery: false });
    await insertBooking({ name: "A different invitee", email: "different@example.test" });
    await insertBooking({ name: "NeedleABSeries wildcard lookalike" });
    const unicodeInvitee = await insertBooking({ name: "Élodie Guest", email: "elodie@example.test" });

    const search = new URLSearchParams({
      state: "confirmed",
      time: "future",
      eventTypeId: setup.eventId,
      from: "2030-05-15T00:00:00.000Z",
      to: "2030-05-16T23:59:59.999Z",
      deliveryFailed: "true",
      query: "NEEDLE%_*?[]SERIES",
    });
    const endpoint = `/api/app/bookings?${search}`;
    const anonymous = await runtime.api(endpoint, { headers: { cookie: "" } });
    assert.equal(anonymous.status, 401, "the combined booking list remains behind the native operator session");

    const response = await runtime.api(endpoint);
    assert.equal(response.status, 200);
    assert.equal(Number(response.headers.get("X-Total-Count")), 2);
    const result = await response.json();
    assert.deepEqual(result.map((booking) => booking.id), [earlier.id, later.id], "matching bookings are ordered by their start instant");
    assert.ok(result.every((booking) => booking.state === "confirmed" && booking.eventTypeId === setup.eventId && booking.inviteeName.toLowerCase().includes("needle%_*?[]series")));

    search.set("limit", "1");
    search.set("offset", "1");
    const nextPage = await runtime.api(`/api/app/bookings?${search}`);
    assert.equal(nextPage.status, 200);
    assert.equal(Number(nextPage.headers.get("X-Total-Count")), 2, "the total count covers every match across pages");
    assert.deepEqual((await nextPage.json()).map((booking) => booking.id), [later.id], "a later page reaches matches beyond the first response batch");
    search.delete("limit");
    search.delete("offset");

    search.set("deliveryFailed", "false");
    const withoutFailures = await runtime.api(`/api/app/bookings?${search}`);
    assert.equal(withoutFailures.status, 200);
    assert.equal(Number(withoutFailures.headers.get("X-Total-Count")), 1);
    assert.deepEqual((await withoutFailures.json()).map((booking) => booking.id), [noFailedDelivery.id]);

    search.set("deliveryFailed", "true");
    search.set("query", "NEEDLE+MAIL");
    const emailSearch = await runtime.api(`/api/app/bookings?${search}`);
    assert.equal(emailSearch.status, 200);
    assert.equal(Number(emailSearch.headers.get("X-Total-Count")), 2);
    assert.deepEqual((await emailSearch.json()).map((booking) => booking.id), [earlier.id, later.id], "search also matches invitee email without matching the invitee name");

    search.set("query", "élodie");
    const unicodeSearch = await runtime.api(`/api/app/bookings?${search}`);
    assert.equal(unicodeSearch.status, 200);
    assert.equal(Number(unicodeSearch.headers.get("X-Total-Count")), 1);
    assert.deepEqual((await unicodeSearch.json()).map((booking) => booking.id), [unicodeInvitee.id], "a lowercase accented search matches an uppercase accented invitee name");

    search.set("query", "él");
    const shortUnicodeSearch = await runtime.api(`/api/app/bookings?${search}`);
    assert.equal(shortUnicodeSearch.status, 200);
    assert.equal(Number(shortUnicodeSearch.headers.get("X-Total-Count")), 1);
    assert.deepEqual((await shortUnicodeSearch.json()).map((booking) => booking.id), [unicodeInvitee.id], "short Unicode substrings also compare case-insensitively");

    const fullFold = await insertBooking({ name: "Straße ẞ Σςσ ﬃ", email: "fullfold@example.test" });
    for (const query of ["STRASSE", "straße", "ẞ", "σσσ", "ΣΣΣ", "ςςς", "FFI"]) {
      search.set("query", query);
      const response = await runtime.api(`/api/app/bookings?${search}`);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).map(booking => booking.id), [fullFold.id], "full Unicode equivalence classes match without changing the original name");
    }
    const nulInvitee = await insertBooking({ name: "Embedded\0Straße", email: "nul@example.test" });
    search.set("query", "\0STRASSE");
    const nulSearch = await runtime.api(`/api/app/bookings?${search}`);
    assert.equal(nulSearch.status, 200);
    const nulRecords = await nulSearch.json();
    assert.deepEqual(nulRecords.map(booking => booking.id), [nulInvitee.id]);
    assert.equal(nulRecords[0].inviteeName, "Embedded\0Straße");

    const longName = "ẞ".repeat(160);
    const longInvitee = await insertBooking({ name: longName, email: "long@example.test" });
    search.set("query", "ß".repeat(160));
    const longSearch = await runtime.api(`/api/app/bookings?${search}`);
    assert.equal(longSearch.status, 200, "a valid long Unicode query is accepted regardless of folded byte length");
    const longRecords = await longSearch.json();
    assert.deepEqual(longRecords.map(booking => booking.id), [longInvitee.id]);
    assert.equal(longRecords[0].inviteeName, longName);

    search.set("query", "NEEDLE%_*?[]SERIES");
    search.set("from", "2030-05-15T11:00:00+02:00");
    search.set("to", "2030-05-15T08:00:00-01:00");
    const equivalentOffsetRange = await runtime.api(`/api/app/bookings?${search}`);
    assert.equal(equivalentOffsetRange.status, 200, "different offset strings for the same instant are accepted as an equal inclusive range");
    assert.equal(Number(equivalentOffsetRange.headers.get("X-Total-Count")), 1);
    assert.deepEqual((await equivalentOffsetRange.json()).map((booking) => booking.id), [earlier.id], "UTC normalization includes the booking exactly on the range boundary");

    // Exercise both actual booking producers, with only calendar/mail paid edges synthetic.
    const event = await runtime.data(`/api/app/event-types/${setup.eventId}`);
    const week = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const available = await runtime.data(`/api/public/book/dial-host/intro/availability?week=${week}`);
    assert.ok(available.slots.length > 2);
    const answers = { [event.questions[0].key]: "Preserved native answer" };
    const selection = await runtime.data("/api/public/book/dial-host/intro/selection", { startAt: available.slots[0].startAt, inviteeTimezone: "UTC" }, 201);
    await runtime.data("/api/public/book/dial-host/intro/confirm", { nonce: selection.nonce, startAt: available.slots[0].startAt, inviteeTimezone: "UTC", name: "Public Straße", email: "public-fold@example.test", answers }, 201);
    const operator = await runtime.data("/api/app/bookings", { eventTypeId: setup.eventId, startAt: available.slots[2].startAt, inviteeTimezone: "UTC", name: "Operator Σςσ", email: "operator-fold@example.test", answers }, 201);
    for (const [query, name] of [["PUBLIC STRASSE", "Public Straße"], ["OPERATOR ςςς", "Operator Σςσ"]]) {
      const response = await runtime.api(`/api/app/bookings?${new URLSearchParams({ query })}`);
      assert.equal(response.status, 200);
      const records = await response.json();
      assert.equal(records.length, 1);
      assert.equal(records[0].inviteeName, name);
      assert.equal(records[0].answers[0].value, "Preserved native answer");
      assert.ok(records[0].history.some(entry => entry.action === "created"));
      assert.ok(records[0].deliveries.length > 0);
    }
    assert.equal(operator.inviteeName, "Operator Σςσ");
    const unmarked = await runtime.data('/api/app/bookings?attendance=attended');
    assert.deepEqual(unmarked, [], 'an attendance filter does not invent marks');
    await runtime.data(`/api/app/bookings/${ended.id}/attendance`, {status:'attended',note:'Completed consultation'});
    const marked = await runtime.api('/api/app/bookings?attendance=attended&time=past&state=confirmed&limit=1');
    assert.equal(Number(marked.headers.get('X-Total-Count')),1);
    assert.deepEqual((await marked.json()).map(row=>row.id),[ended.id]);
    const remaining = await runtime.data('/api/app/bookings?attendance=unmarked');
    assert.ok(remaining.length>0 && remaining.every(row=>row.id!==ended.id));
    assert.equal((await runtime.api('/api/app/bookings?attendance=unknown')).status,400);

  } finally {
    await runtime.close();
  }
});
