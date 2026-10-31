import assert from "node:assert/strict";
import { ulid } from "ulid";
import { contract } from "./contract.mjs";
import { bookingRuntime } from "./move-in/booking-runtime.mjs";
import { csvRecords } from "../src/core/features/move-in/providers/csv.ts";
import { csvLifecycle } from "./report-booking-csv/lifecycle.mjs";

contract("REPORT-003", "owner CSV exports every filtered booking safely without changing booking, delivery or accounting custody", async () => {
  const runtime = await bookingRuntime();
  try {
    const { eventId } = await runtime.data("/__fixtures/setup", {});
    const profile = await runtime.data("/api/app/profile");
    await runtime.data("/api/app/profile", { ...profile, timezone: "America/New_York", focusAreas: profile.focusAreas.map(({ label }) => ({ label })), socialProof: profile.socialProof.map(({ quote, attribution }) => ({ quote, attribution })) }, 200, "PATCH");
    const otherEvent = await runtime.data("/api/app/event-types", {
      slug: "synthetic-dial-other", title: "Other event", description: "CSV exclusion control", durationMinutes: 30, color: "#176b5a",
      locationType: "fixed_link", locationLabel: "Meeting", locationValue: "https://dial.test/meeting", listed: true,
      alternativeRequestsEnabled: false, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90,
      beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: [],
    }, 201);
    const operatorId = (await runtime.db.prepare("SELECT id FROM operators LIMIT 1").first()).id;
    const now = "2026-03-02T12:00:00.000Z";
    const privateMarker = "synthetic-dial-private-1";
    const unicodeName = 'Élodie, "桜"\r\nStraße';
    const formulaName = '=HYPERLINK("https://dial.test/untrusted","open")';
    const expected = [];
    const insert = async ({ index, event = eventId, state = "confirmed", startAt = "2026-03-08T08:00:00.000Z", failed = true, attended = false, name = `synthetic-dial-${index}`, searchable = true }) => {
      const id = ulid(), occurrenceId = ulid();
      const endAt = new Date(Date.parse(startAt) + 30 * 60_000).toISOString();
      await runtime.db.batch([
        runtime.db.prepare(`INSERT INTO bookings (id,event_type_id,event_slug,event_title,duration_minutes,location_type,location_label,location_value,
          invitee_name,invitee_email,host_timezone,invitee_timezone,state,ical_uid,calendar_state,meeting_state,current_occurrence_id,created_at,updated_at)
          VALUES (?,?,'synthetic-dial-event','Consultation, 桜',30,'fixed_link','Meeting',?, ?,?,'America/New_York','Asia/Tokyo',?,?,'succeeded','not_required',NULL,?,?)`)
          .bind(id, event, `https://dial.test/meeting?private=${privateMarker}`, name, [searchable ? `synthetic-dial-${index}` : "unrelated", "dial.test"].join("@"), state, `synthetic-dial-${id}`, now, now),
        runtime.db.prepare(`INSERT INTO booking_occurrences (id,booking_id,sequence,start_at,end_at,occupied_start_at,occupied_end_at,host_date,state,is_current,created_at)
          VALUES (?,?,0,?,?,?,?, '2026-03-08',?,1,?)`).bind(occurrenceId, id, startAt, endAt, startAt, endAt, state === "cancelled" ? "cancelled" : "current", now),
        runtime.db.prepare("UPDATE bookings SET current_occurrence_id=? WHERE id=?").bind(occurrenceId, id),
        ...(failed ? [runtime.db.prepare(`INSERT INTO delivery_outbox (id,kind,idempotency_key,booking_id,occurrence_id,payload_json,state,attempts,next_attempt_at,last_error_code,created_at,updated_at)
          VALUES (?,'mail_send',?,?,?,?,'failed',1,?,'synthetic-dial-failure',?,?)`).bind(ulid(), `synthetic-dial-${id}`, id, occurrenceId, JSON.stringify({ manageToken: privateMarker, credential: privateMarker }), now, now, now)] : []),
        ...(attended ? [runtime.db.prepare("INSERT INTO booking_attendance (booking_id,status,note,marked_by_operator_id,marked_at) VALUES (?,'attended','synthetic-dial-1',?,?)").bind(id, operatorId, now)] : []),
      ]);
      return id;
    };
    for (let index = 0; index < 503; index++) expected.push(await insert({ index, name: index === 0 ? unicodeName : index === 1 ? formulaName : undefined, startAt: new Date(Date.parse("2026-03-08T07:00:00.000Z") + index * 60_000).toISOString() }));
    await insert({ index: 503, state: "cancelled" });
    await insert({ index: 504, state: "rescheduled" });
    await insert({ index: 505, event: otherEvent.id });
    await insert({ index: 506, startAt: "2026-03-08T04:59:59.999Z" });
    await insert({ index: 507, startAt: "2026-03-09T04:00:00.000Z" });
    await insert({ index: 508, failed: false });
    await insert({ index: 509, attended: true });
    await insert({ index: 510, searchable: false, name: "Unrelated invitee" });
    await runtime.db.batch([
      runtime.db.prepare("INSERT INTO booking_manage_tokens (id,booking_id,token_hash,expires_at,created_at,updated_at) VALUES (?,?,?,'2030-01-01',?,?)").bind(ulid(), expected[0], privateMarker, now, now),
      runtime.db.prepare("INSERT INTO booking_payments (id,booking_id,account_id,amount_cents,checkout_session_id,paid_at,created_at,updated_at) VALUES (?,?,?,5000,?,?,?,?)").bind(ulid(), expected[0], privateMarker, "synthetic-dial-checkout-1", now, now, now),
      runtime.db.prepare("INSERT INTO accounting_connections (id,realm_id,status,access_token_ciphertext,refresh_token_ciphertext,created_at,updated_at) VALUES ('synthetic-dial-1','synthetic-dial-1','healthy',?,?,?,?)").bind(privateMarker, privateMarker, now, now),
      runtime.db.prepare("INSERT INTO accounting_exports (id,booking_id,connection_id,payment_ref,amount_cents,request_id,document_ref,payload_json,state,created_at,updated_at) VALUES (?,?,'synthetic-dial-1','synthetic-dial-1',5000,'synthetic-dial-1','synthetic-dial-1',?,'succeeded',?,?)").bind(ulid(), expected[0], JSON.stringify({ private: privateMarker }), now, now),
    ]);
    const tables = ["bookings", "booking_occurrences", "booking_manage_tokens", "booking_answers", "booking_history", "booking_attendance", "delivery_outbox", "booking_payments", "payment_movements", "payment_processor_facts", "accounting_connections", "accounting_exports", "api_credentials"];
    const snapshot = () => Promise.all(tables.map(async table => (await runtime.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results));
    const exportIds = async query => {
      const response = await runtime.api(`/api/app/reports/bookings.csv?${query}`);
      assert.equal(response.status, 200);
      return csvRecords(await response.text()).map(row => row.bookingId);
    };
    await csvLifecycle(runtime, { eventId, exportIds, snapshot });
    const before = await snapshot();
    const filters = new URLSearchParams({ state: "confirmed", eventTypeId: eventId, fromDate: "2026-03-08", throughDate: "2026-03-08", attendance: "unmarked", deliveryFailed: "true", query: "SYNTHETIC-DIAL-" });
    const endpoint = `/api/app/reports/bookings.csv?${filters}`;
    const anonymous = await runtime.api(endpoint, { headers: { cookie: "" } });
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).error.code, "session_required");
    const response = await runtime.api(endpoint);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Type"), /^text\/csv; charset=utf-8$/u);
    assert.match(response.headers.get("Content-Disposition"), /^attachment;/u);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("X-Host-Timezone"), "America/New_York");
    const text = await response.text();
    const rows = csvRecords(text);
    assert.deepEqual(rows.map(row => row.bookingId), expected, "all 503 matches, including those beyond the display limit, are exported in list order");
    assert.equal(rows[0].inviteeName, unicodeName, "Unicode, commas, quotes and embedded record separators round-trip");
    assert.equal(rows[0].eventTitle, "Consultation, 桜");
    assert.equal(rows[0].startAt, "2026-03-08T07:00:00.000Z");
    assert.equal(rows[0].endAt, "2026-03-08T07:30:00.000Z");
    assert.equal(rows[0].durationMinutes, "30");
    assert.equal(rows[0].inviteeTimezone, "Asia/Tokyo");
    assert.equal(rows[1].inviteeName, `'${formulaName}`, "untrusted spreadsheet formulas are exported as literal text");
    assert.ok(!text.includes(privateMarker), "no manage authority, delivery payload or accounting credential crosses the projection");
    assert.ok(rows.every(row => Object.keys(row).every(key => !/token|secret|credential|payload|manage/iu.test(key))));

    const displayed = [];
    for (const offset of [0, 200, 400]) {
      const response = await runtime.api(`/api/app/bookings?${filters}&limit=200&offset=${offset}`);
      assert.equal(response.status, 200);
      assert.equal(Number(response.headers.get("X-Total-Count")), 503);
      displayed.push(...(await response.json()).map(row => row.id));
    }
    assert.deepEqual(displayed, expected, "the native list uses the identical combined predicate");
    assert.deepEqual(await exportIds(`${filters}&limit=1&offset=500`), expected, "display pagination never limits the export");
    assert.deepEqual(await exportIds(`${filters}&paymentState=paid`), [expected[0]], "the export retains main's paid-booking filter");
    assert.deepEqual(await exportIds(`${filters}&paymentState=free`), expected.slice(1), "payment-state and combined export filters share the list predicate");
    assert.deepEqual(await exportIds(`${filters}&paymentState=unpaid`), [], "an unmatched payment state never broadens the export");
    const unicode = new URLSearchParams({ query: "ÉLODIE" });
    assert.deepEqual(await exportIds(unicode), [expected[0]], "native Unicode search semantics carry through to the CSV");
    const instant = new URLSearchParams({ from: "2026-03-08T08:00:00+01:00", to: "2026-03-08T07:00:00Z", state: "confirmed", eventTypeId: eventId });
    assert.deepEqual(await exportIds(instant), [expected[0]], "equivalent offsets retain the list's inclusive boundaries");
    const drill = new URLSearchParams({ report: "created", periodFrom: "2026-03-01", periodThrough: "2026-03-31", eventTypeId: otherEvent.id });
    const drillList = await runtime.data(`/api/app/bookings?${drill}`);
    assert.equal(drillList.length, 1);
    assert.deepEqual(await exportIds(drill), drillList.map(row => row.id), "report tile membership is resolved before exporting");
    assert.deepEqual(await exportIds("query=does-not-match"), [], "an empty filter returns a readable header-only CSV");
    for (const query of ["state=unknown", "attendance=unknown", "paymentState=unknown", "fromDate=2026-03-09&throughDate=2026-03-08", "from=2026-03-09T00:00:00Z&to=2026-03-08T00:00:00Z", "report=created", "fromDate=2026-03-08&from=2026-03-08T00:00:00Z"]) {
      assert.equal((await runtime.api(`/api/app/reports/bookings.csv?${query}`)).status, 400, "invalid native filter semantics are refused");
    }
    assert.deepEqual(await snapshot(), before, "allowed and refused exports leave booking, delivery, payment and accounting rows unchanged");
    console.log("PROBE REPORT-003 filtered CSV: combined native filters -> exact 503 ordered IDs across display pages; pagination ignored; Unicode and escaped cells round-trip; formulas are literal; private data excluded; anonymous and invalid filters refused; product rows unchanged");
    await runtime.db.prepare("DELETE FROM oa_sessions WHERE operator_id=?").bind(operatorId).run();
    assert.equal((await runtime.api(endpoint)).status, 401, "revocation prevents a previously valid session from exporting again");
    assert.deepEqual(await snapshot(), before);
    console.log("PROBE REPORT-003 revocation: previously valid owner CSV request -> 401 after session revocation; product rows unchanged");
  } finally {
    await runtime.close();
  }
});
