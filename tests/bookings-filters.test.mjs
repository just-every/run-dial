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

contract("REPORT-002", "payment-state filters select exact booking identities and totals before combined filters and pagination without money writes", async () => {
  const runtime = await bookingRuntime();
  try {
    const setup = await runtime.data("/__fixtures/setup", {});
    const now = "2026-01-01T00:00:00.000Z";
    const fixtures = [
      { name: "free", expected: "free" },
      { name: "free-with-failed-fee", expected: "free", movement: ["no_show_fee", "failed", 500] },
      { name: "full-payment", expected: "paid", payment: 10000 },
      { name: "deposit", expected: "balance_due", payment: 4000, balance: 6000 },
      { name: "pending-balance", expected: "balance_due", payment: 4000, balance: 6000, movement: ["balance", "pending", 6601] },
      { name: "failed-balance", expected: "balance_due", payment: 4000, balance: 6000, movement: ["balance", "failed", 6601] },
      { name: "settled-balance", expected: "paid", payment: 4000, balance: 6000, movement: ["balance", "succeeded", 6601] },
      { name: "balance-tax-still-due", expected: "balance_due", payment: 4000, balance: 6000, movement: ["balance", "succeeded", 6000] },
      { name: "cancelled-deposit", expected: "paid", payment: 4000, balance: 6000, state: "cancelled" },
      { name: "partial-refund", expected: "refunded", payment: 10000, movement: ["refund", "succeeded", 100] },
      { name: "full-refund", expected: "refunded", payment: 10000, movement: ["refund", "succeeded", 10000] },
      { name: "refunded-deposit", expected: "refunded", payment: 4000, balance: 6000, movement: ["refund", "succeeded", 4000] },
      { name: "pending-refund", expected: "paid", payment: 10000, movement: ["refund", "pending", 10000] },
      { name: "failed-refund", expected: "paid", payment: 10000, movement: ["refund", "failed", 10000] },
      { name: "processor-refund", expected: "refunded", payment: 10000, fact: "succeeded" },
      { name: "pending-processor-refund", expected: "paid", payment: 10000, fact: "pending" },
      { name: "failed-processor-refund", expected: "paid", payment: 10000, fact: "failed" },
      { name: "pending-invoice", expected: "unpaid", movement: ["invoice", "pending", 10000] },
      { name: "paid-invoice", expected: "paid", movement: ["invoice", "succeeded", 10000] },
      { name: "unpaid-price", expected: "unpaid", price: 10000 },
      { name: "paid-fee", expected: "paid", movement: ["no_show_fee", "succeeded", 500] },
    ];
    for (const [index, fixture] of fixtures.entries()) {
      fixture.id = ulid();
      const occurrenceId = ulid();
      const start = `2030-05-15T12:${String(index).padStart(2, "0")}:00.000Z`;
      const end = new Date(Date.parse(start) + 30 * 60000).toISOString();
      const reference = `synthetic-dial-${index}`;
      const paymentRef = `${reference}-payment`;
      await runtime.db.batch([
        runtime.db.prepare(`INSERT INTO bookings (id,event_type_id,event_slug,event_title,duration_minutes,location_type,location_label,location_value,invitee_name,invitee_email,host_timezone,invitee_timezone,state,ical_uid,calendar_state,meeting_state,created_at,updated_at)
          VALUES (?,?,'payment-filter','Payment filter',30,'fixed_link','Meeting','https://dial.test/meeting',?,?,'UTC','UTC',?,?,'succeeded','not_required',?,?)`)
          .bind(fixture.id, setup.eventId, `synthetic-dial-${fixture.name}`, [reference, "dial.test"].join("@"), fixture.state ?? "confirmed", reference, now, now),
        runtime.db.prepare(`INSERT INTO booking_occurrences (id,booking_id,sequence,start_at,end_at,occupied_start_at,occupied_end_at,host_date,state,is_current,created_at)
          VALUES (?,?,0,?,?,?,?, '2030-05-15',?,1,?)`)
          .bind(occurrenceId, fixture.id, start, end, start, end, fixture.state === "cancelled" ? "cancelled" : "current", now),
        runtime.db.prepare("UPDATE bookings SET current_occurrence_id=? WHERE id=?").bind(occurrenceId, fixture.id),
        ...(fixture.payment ? [runtime.db.prepare(`INSERT INTO booking_payments (id,booking_id,account_id,amount_cents,checkout_session_id,payment_intent_id,paid_at,created_at,updated_at,kind)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(ulid(), fixture.id, "synthetic-dial-account", fixture.payment, `${reference}-checkout`, paymentRef, now, now, now, fixture.balance ? "deposit" : "payment")] : []),
        ...(fixture.balance || fixture.price ? [runtime.db.prepare(`INSERT INTO booking_payment_terms (booking_id,price_cents,deposit_cents,due_now_cents,balance_cents,balance_due_hours,terms_version,created_at,tax_cents)
          VALUES (?,10000,?,?,?,24,1,?,?)`).bind(fixture.id, fixture.balance ? 4000 : 0, fixture.balance ? 4000 : 10000, fixture.balance ?? 0, now, fixture.balance ? 1001 : 0)] : []),
        ...(fixture.movement ? [runtime.db.prepare(`INSERT INTO payment_movements (id,booking_id,kind,amount_cents,status,actor_type,reason,account_id,source_ref,processor_ref,idempotency_key,created_at,updated_at)
          VALUES (?,?,?,?,?,'invitee','Synthetic filter fixture',?,?,?,?,?,?)`)
          .bind(ulid(), fixture.id, fixture.movement[0], fixture.movement[2], fixture.movement[1], "synthetic-dial-account", paymentRef, `${reference}-movement`, reference, now, now)] : []),
        ...(fixture.fact ? [runtime.db.prepare(`INSERT INTO payment_processor_facts (id,booking_id,account_id,kind,processor_ref,source_ref,amount_cents,status,event_created,created_at,updated_at)
          VALUES (?,?,?,'refund',?,?,100,?,0,?,?)`).bind(ulid(), fixture.id, "synthetic-dial-account", `${reference}-refund`, paymentRef, fixture.fact, now, now)] : []),
      ]);
    }
    // Multiple successful refunds must still select a booking exactly once.
    const refunded = fixtures.find(row => row.name === "partial-refund");
    await runtime.db.prepare(`INSERT INTO payment_movements (id,booking_id,kind,amount_cents,status,actor_type,reason,account_id,idempotency_key,created_at,updated_at)
      VALUES (?,?,'refund',100,'succeeded','invitee','Second synthetic refund','synthetic-dial-account','synthetic-dial-second-refund',?,?)`).bind(ulid(), refunded.id, now, now).run();
    const snapshot = async () => Promise.all(["bookings", "booking_payments", "booking_payment_terms", "payment_movements", "payment_processor_facts", "delivery_outbox", "accounting_exports"].map(table => runtime.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().then(result => result.results)));
    const before = await snapshot();
    const check = async (filters, expectedIds, total = expectedIds.length) => {
      const response = await runtime.api(`/api/app/bookings?${new URLSearchParams(filters)}`);
      assert.equal(response.status, 200);
      assert.equal(Number(response.headers.get("X-Total-Count")), total, "the count uses the payment predicate before pagination");
      assert.deepEqual((await response.json()).map(row => row.id), expectedIds, "the public list returns exactly the expected identities in start order");
    };
    for (const paymentState of ["free", "unpaid", "paid", "balance_due", "refunded"]) {
      const ids = fixtures.filter(row => row.expected === paymentState).map(row => row.id);
      await check({ paymentState }, ids);
      await check({ paymentState, limit: "1", offset: "1" }, ids.slice(1, 2), ids.length);
      await check({ paymentState, limit: "1", offset: "500" }, [], ids.length);
      const anonymous = await runtime.api(`/api/app/bookings?paymentState=${paymentState}`, { headers: { cookie: "" } });
      assert.equal(anonymous.status, 401, "payment facts remain session gated");
    }
    const combined = { paymentState: "paid", state: "confirmed", attendance: "unmarked", eventTypeId: setup.eventId, from: "2030-05-15T12:06:00.000Z", to: "2030-05-15T12:14:00.000Z", deliveryFailed: "false", query: "SYNTHETIC-DIAL" };
    const combinedIds = fixtures.filter(row => ["settled-balance", "pending-refund", "failed-refund"].includes(row.name)).map(row => row.id);
    await check(combined, combinedIds);
    await check({ ...combined, limit: "1", offset: "2" }, combinedIds.slice(2), 3);
    await check({ ...combined, attendance: "attended" }, []);
    await check({ ...combined, deliveryFailed: "true" }, []);
    await check({ ...combined, query: "no matching invitee" }, []);
    for (const paymentState of ["unknown", "", "PAID", "paid,free", "paid' OR 1=1"]) {
      assert.equal((await runtime.api(`/api/app/bookings?${new URLSearchParams({ paymentState })}`)).status, 400, "invalid payment states are refused instead of broadening the list");
    }
    await check({}, fixtures.map(row => row.id));
    assert.deepEqual(await snapshot(), before, "filtered reads and refusals leave bookings, delivery, money and accounting rows unchanged");
  } finally {
    await runtime.close();
  }
});
