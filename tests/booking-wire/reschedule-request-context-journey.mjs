import assert from "node:assert/strict";
import { bookingMail, recipient, textBody } from "./mail-contracts.mjs";

const address = id => [`synthetic-dial-${id}`, "example.test"].join("@");
const guestsFor = (snapshot, id) => snapshot.booking_guests.filter(row => row.booking_id === id);
function calendarWrites(snapshot, booking) {
  return snapshot.wire_calls.filter(row => {
    const url = new URL(row.url);
    if (url.hostname !== "www.googleapis.com") return false;
    return row.method === "POST" && url.pathname.endsWith("/events")
      ? JSON.parse(row.body).extendedProperties.private["dial-booking-id"] === booking.id
      : ["PATCH", "DELETE"].includes(row.method) && url.pathname.endsWith(`/events/${booking.calendar_provider_event_id}`);
  });
}
function businessState(snapshot) {
  return Object.fromEntries([
    "bookings", "booking_guests", "booking_occurrences", "booking_nonces", "booking_history",
    "booking_reschedule_requests", "booking_request_history", "delivery_outbox", "wire_events",
  ].map(table => [table, snapshot[table]]));
}

export async function rescheduleRequestContextJourney({ data, call, state, deliver, future, checks }) {
  const authorization = new URL((await call("/api/app/calendar/oauth/start", undefined, 302)).headers.get("location"));
  await call(`/api/calendar/oauth/callback?${new URLSearchParams({ state: authorization.searchParams.get("state"), code: "wire-consent" })}`, undefined, 302);
  await data("/api/app/calendar/selection", { destinationCalendarId: "synthetic-calendar", conflictCalendarIds: ["synthetic-calendar"] }, 200, "PUT");
  assert.equal((await data("/api/app/calendar/check", {})).kind, "healthy");
  await data("/api/app/mail/check", {});

  const event = await data("/api/app/event-types", {
    slug: "synthetic-dial-request-context", title: "Studio consultation", description: "Plan a synthetic commission.",
    durationMinutes: 60, color: "#176b5a", locationType: "google_meet", locationLabel: "Google Meet", locationValue: "",
    listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 30, minimumNoticeMinutes: 0,
    bookingHorizonDays: 90, beforeBufferMinutes: 15, afterBufferMinutes: 15, hostDayBookingLimit: null,
    questions: [
      { kind: "text", label: "Project goals", required: true, private: false, options: [] },
      { kind: "text", label: "Private budget", required: true, private: true, options: [] },
    ],
    availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 540, endMinute: 1080 })),
  }, 201);
  await data(`/api/app/event-types/${event.id}/guests`, { guestLimit: 2 }, 200, "PUT");
  await data(`/api/app/event-types/${event.id}/publish`, {});
  const base = `/api/public/book/dial-host/${event.slug}`;
  const answers = {
    [event.questions[0].key]: "A café sculpture\nBronze and glass",
    [event.questions[1].key]: "synthetic-dial-private-941",
  };
  async function book(index) {
    const slot = (await data(`${base}/availability?week=${future}`)).slots[0]; assert.ok(slot);
    const selection = await data(`${base}/selection`, { startAt: slot.startAt, inviteeTimezone: "UTC", durationMinutes: 60 }, 201);
    const email = address(index), guests = [address(index + 1), address(index + 2)];
    const receipt = await data(`${base}/confirm`, {
      nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: "UTC", durationMinutes: 60,
      name: "Avery Chen", email, answers, guests,
    }, 201);
    await deliver();
    const snapshot = await state(), booking = snapshot.bookings.find(row => row.id === receipt.bookingReference);
    assert.ok(booking);
    const token = new URL(receipt.manageUrl).pathname.split("/").at(-1);
    return { receipt, booking, token, email, guests, manage: `/api/public/manage/${token}` };
  }
  const control = await book(950);
  const controlRows = snapshot => Object.fromEntries([
    "bookings", "booking_guests", "booking_occurrences", "booking_history", "delivery_outbox",
  ].map(table => [table, snapshot[table].filter(row => table === "bookings" ? row.id === control.booking.id : row.booking_id === control.booking.id)]));
  const controlBefore = controlRows(await state());
  const controlRecord = await data(`/api/app/bookings/${control.booking.id}`);

  for (const [index, releaseTime] of [true, false].entries()) {
    const subject = await book(960 + index * 10), id = subject.booking.id;
    const initial = await state(), record = await data(`/api/app/bookings/${id}`);
    assert.deepEqual(Object.fromEntries(record.answers.map(answer => [answer.key, answer.value])), answers,
      "both nonempty public and private submitted values are stored");
    const guestRows = guestsFor(initial, id);
    assert.deepEqual(guestRows.map(row => row.email).sort(), subject.guests);
    assert.equal(guestRows.length, 2);
    assert.equal(subject.booking.calendar_state, "succeeded");
    assert.ok(subject.booking.calendar_provider_event_id);
    assert.equal(calendarWrites(initial, subject.booking).length, 1);
    const originalProvider = JSON.parse(initial.wire_events.find(row => row.id === subject.booking.calendar_provider_event_id).payload);
    assert.deepEqual(originalProvider.attendees.map(row => row.email).sort(), [subject.email, ...subject.guests].sort());

    async function assertContext(snapshot) {
      const stored = await data(`/api/app/bookings/${id}`), manage = await data(subject.manage);
      assert.deepEqual(stored.answers, record.answers, "stored answer values and question identities survive unchanged");
      assert.deepEqual(guestsFor(snapshot, id), guestRows, "the same guest memberships survive unchanged");
      assert.deepEqual(manage.guests, subject.guests, "the original invitee capability still manages both guests");
      assert.equal(stored.id, record.id);
      assert.equal(stored.eventTypeId, event.id);
      assert.equal(stored.durationMinutes, 60);
      assert.equal(manage.event.durationMinutes, 60);
      assert.equal(manage.bookingReference, id);
      assert.ok(manage.manageUrl === subject.receipt.manageUrl, "the original manage capability is retained");
      assert.equal(stored.icalUid, record.icalUid);
      assert.equal(stored.calendarProviderEventId, record.calendarProviderEventId);
      return stored;
    }
    async function refuseStrangers() {
      const before = await state();
      const request = { message: "Untrusted guest request", releaseTime, expiresInDays: 14, reminderHours: null };
      async function anonymous(path, body, status, method = body === undefined ? "GET" : "POST") {
        const response = await fetch(new URL(path, subject.receipt.manageUrl), {
          method, headers: { origin: new URL(subject.receipt.manageUrl).origin, "content-type": ["application", "json"].join("/") },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        assert.equal(response.status, status, "a guest address is no owner session or manage capability");
        await response.arrayBuffer();
      }
      await anonymous(`/api/app/bookings/${id}/reschedule-request`, { ...request, email: subject.guests[0] }, 401);
      for (const guest of subject.guests) {
        const manage = `/api/public/manage/${encodeURIComponent(guest)}`;
        await anonymous(manage, undefined, 404);
        await anonymous(`${manage}/reschedule/availability?week=${future}`, undefined, 404);
        await anonymous(`${manage}/reschedule/selection`, { startAt: subject.receipt.occurrence.startAt, inviteeTimezone: "UTC" }, 404);
        await anonymous(`${manage}/reschedule`, { nonce: "synthetic-dial-unknown", startAt: subject.receipt.occurrence.startAt, inviteeTimezone: "UTC" }, 404);
        await anonymous(`${manage}/guests`, { guests: [] }, 404, "PUT");
        await anonymous(`${manage}/cancel`, {}, 404);
      }
      assert.deepEqual(businessState(await state()), businessState(before), "refused outsiders change no booking or effects");
    }
    await refuseStrangers();
    const requested = await data(`/api/app/bookings/${id}/reschedule-request`, {
      message: "The studio session moved. Please choose another time.", releaseTime, expiresInDays: 14, reminderHours: null,
    });
    assert.equal(requested.rescheduleRequest.state, "open");
    assert.equal(requested.rescheduleRequest.releaseTime, releaseTime);
    await deliver();
    const open = await state(), openRecord = await assertContext(open);
    assert.deepEqual(openRecord.occurrence, record.occurrence, "request creation keeps the original occurrence");
    assert.equal(open.booking_occurrences.find(row => row.id === subject.booking.current_occurrence_id).blocks_time, releaseTime ? 0 : 1);
    assert.equal(calendarWrites(open, subject.booking).length, releaseTime ? 2 : 1);
    const openProvider = JSON.parse(open.wire_events.find(row => row.id === originalProvider.id).payload);
    assert.deepEqual(openProvider.attendees, originalProvider.attendees, "request creation retains every provider attendee");
    assert.deepEqual(openProvider.conferenceData, originalProvider.conferenceData);
    for (const guest of subject.guests) {
      assert.equal(bookingMail(open, id).filter(mail => recipient(mail).includes(guest)).length, 1,
        "opening a request sends the guest no new notice");
    }
    const requestMail = bookingMail(open, id).filter(mail => textBody(mail).includes("The studio session moved."));
    assert.equal(requestMail.length, 1);
    assert.deepEqual(recipient(requestMail[0]), [subject.email]);
    assert.ok(textBody(requestMail[0]).includes(subject.receipt.manageUrl), "the request uses the original invitee capability");
    await refuseStrangers();

    const next = (await data(`${subject.manage}/reschedule/availability?week=${future}`)).slots
      .find(slot => slot.startAt > subject.receipt.occurrence.endAt);
    assert.ok(next);
    const selection = await data(`${subject.manage}/reschedule/selection`, { startAt: next.startAt, inviteeTimezone: "UTC", durationMinutes: 60 }, 201);
    const pick = { nonce: selection.nonce, startAt: next.startAt, inviteeTimezone: "UTC", durationMinutes: 60 };
    const changed = await data(`${subject.manage}/reschedule`, pick);
    assert.equal(changed.rescheduleRequest.state, "picked");
    assert.ok(changed.manageUrl === subject.receipt.manageUrl);
    await deliver();
    const picked = await state(), pickedRecord = await assertContext(picked);
    assert.equal(pickedRecord.occurrence.startAt, next.startAt);
    assert.equal(Date.parse(pickedRecord.occurrence.endAt) - Date.parse(next.startAt), 60 * 60000);
    assert.notEqual(pickedRecord.occurrence.id, record.occurrence.id);
    assert.ok(pickedRecord.occurrence.sequence > record.occurrence.sequence);
    const occurrences = picked.booking_occurrences.filter(row => row.booking_id === id);
    assert.equal(occurrences.length, 2);
    assert.equal(occurrences.filter(row => row.is_current).length, 1);
    const writes = calendarWrites(picked, subject.booking);
    assert.deepEqual(writes.map(row => row.method), releaseTime ? ["POST", "PATCH", "PATCH"] : ["POST", "PATCH"]);
    const provider = JSON.parse(picked.wire_events.find(row => row.id === subject.booking.calendar_provider_event_id).payload);
    assert.equal(provider.id, originalProvider.id);
    assert.equal(provider.start.dateTime, next.startAt);
    assert.equal(provider.end.dateTime, pickedRecord.occurrence.endAt);
    assert.deepEqual(provider.attendees.map(row => row.email).sort(), [subject.email, ...subject.guests].sort());
    assert.deepEqual(provider.conferenceData, originalProvider.conferenceData);
    for (const row of writes) {
      assert.ok(!row.body.includes(answers[event.questions[1].key]), "private answers never reach the guest calendar invitation");
      assert.ok(!row.body.includes(subject.token) && !row.body.includes("/manage/"), "guest calendar invitations carry no invitee capability");
    }
    for (const guest of subject.guests) {
      const mail = bookingMail(picked, id).filter(mail => recipient(mail).includes(guest));
      assert.equal(mail.length, 2, "each guest gets only their original confirmation and one change notice");
      const notices = mail.filter(row => row.subject === `Guest invitation changed: ${event.title}`);
      assert.equal(notices.length, 1);
      assert.ok(textBody(notices[0]).includes(next.startAt) && textBody(notices[0]).includes(pickedRecord.occurrence.endAt));
      assert.ok(mail.every(row => row.content.every(part => Object.values(answers).every(value => !part.value.includes(value)))), "guest mail contains no answers");
      assert.ok(!JSON.stringify(mail).includes(subject.token) && !JSON.stringify(mail).includes("/manage/"), "guest mail grants no manage authority");
    }
    const replay = await data(`${subject.manage}/reschedule`, pick);
    assert.equal(replay.occurrence.startAt, changed.occurrence.startAt);
    for (const row of picked.delivery_outbox.filter(row => row.booking_id === id && row.state === "succeeded" && ["calendar_upsert", "mail_send"].includes(row.kind))) {
      await data("/__fixtures/deliver", { id: row.id });
    }
    await deliver();
    const repeated = await state();
    assert.deepEqual(repeated.booking_occurrences.filter(row => row.booking_id === id), occurrences, "replayed picks add no occurrence");
    assert.deepEqual(repeated.booking_history.filter(row => row.booking_id === id), picked.booking_history.filter(row => row.booking_id === id));
    assert.deepEqual(bookingMail(repeated, id), bookingMail(picked, id), "replayed picks and deliveries send no extra notices");
    assert.deepEqual(calendarWrites(repeated, subject.booking), writes, "replay performs no provider mutation");
    assert.deepEqual(repeated.wire_events, picked.wire_events, "replay creates no extra provider event");
    await assertContext(repeated);
    assert.deepEqual(controlRows(repeated), controlBefore, "the independent control booking remains unchanged");
    assert.deepEqual(await data(`/api/app/bookings/${control.booking.id}`), controlRecord);
    checks.push(`BOOK-014 ${releaseTime ? "release-now" : "held"}: both stored answers and two original guests survive request and pick on the same 60-minute booking and manage capability; one private-safe change notice per guest; stable Google event and Meet; outsider refusal and replay leave controls unchanged`);
  }
}
