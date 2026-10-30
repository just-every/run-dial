import assert from "node:assert/strict";
import { bookingMail, recipient, textBody, wireMail } from "./mail-contracts.mjs";

function calendarWrites(snapshot) {
  return snapshot.wire_calls.filter(call => {
    const url = new URL(call.url);
    return url.hostname === "www.googleapis.com" && (call.method === "POST"
      ? url.pathname.endsWith("/events")
      : ["PATCH", "DELETE"].includes(call.method) && /\/events\/[^/]+$/.test(url.pathname));
  });
}

function noBookingEffects(snapshot, request) {
  assert.ok(!snapshot.bookings.some(row => row.id === request.booking_id), "an unapproved request has no booking");
  assert.ok(!snapshot.booking_occurrences.some(row => row.booking_id === request.booking_id), "an unapproved request has no occurrence");
  assert.ok(!snapshot.delivery_outbox.some(row => row.booking_id === request.booking_id && row.kind !== "mail_send"), "an unapproved request queues no calendar, conference or reminder effects");
  assert.equal(bookingMail(snapshot, request.booking_id).length, 0, "an unapproved request sends no booking confirmation or meeting link");
  assert.equal(wireMail(snapshot).filter(mail => recipient(mail).includes(request.invitee_email)
    && /^(Confirmed:|Reminder:|Your meeting link is ready)/.test(mail.subject)).length, 0, "the invitee receives no premature confirmation, reminder or joining link");
}

export async function approvalMeetJourney({ data, call, state, deliver, future, checks }) {
  const event = await data("/api/app/event-types", {
    slug: "synthetic-dial-approval-meet", title: "Approval video consultation", description: "A synthetic approval request.",
    durationMinutes: 30, color: "#176b5a", locationType: "google_meet", locationLabel: "Google Meet", locationValue: "",
    listed: true, alternativeRequestsEnabled: false, slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90,
    beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [],
    availability: Array.from({ length: 7 }, (_, weekday) => ({ weekday, startMinute: 600, endMinute: 1200 })),
  }, 201);
  await data(`/api/app/event-types/${event.id}/approval`, { required: true, windowHours: 24 }, 200, "PUT");
  await data(`/api/app/event-types/${event.id}/publish`, {});
  const base = `/api/public/book/dial-host/${event.slug}`;
  const slots = () => data(`${base}/availability?week=${future}`);
  const manage = step => `/api/public/manage/${new URL(step.approval.url).pathname.split("/").at(-1)}`;
  const make = async index => {
    const startAt = (await slots()).slots[0].startAt;
    const selection = await data(`${base}/selection`, { startAt, inviteeTimezone: "UTC" }, 201);
    const email = [`synthetic-dial-${810 + index}`, "example.test"].join("@");
    const payload = { nonce: selection.nonce, startAt, inviteeTimezone: "UTC", name: "Synthetic Dial Invitee", email, answers: {} };
    const step = await data(`${base}/confirm`, payload, 202);
    assert.equal(step.approvalRequired, true);
    assert.equal((await data(`${base}/confirm`, payload, 202)).approval.url, step.approval.url, "repeated submission retains the pending request");
    const request = (await state()).booking_approval_requests.find(row => row.invitee_email === email);
    assert.ok(request);
    assert.ok(!(await slots()).slots.some(slot => slot.startAt === startAt), "pending approval holds the selected slot");
    return { payload, step, request };
  };
  const pendingReceipt = async step => {
    const receipt = await data(manage(step));
    assert.equal(receipt.state, "pending_approval");
    assert.equal(receipt.calendarState, "not_required");
    assert.equal(receipt.meetingState, "not_required");
    assert.equal(receipt.location.state, "pending");
    assert.equal(receipt.location.value, undefined, "pending approval discloses no joining link");
  };
  assert.equal(calendarWrites(await state()).length, 0);
  assert.equal((await state()).wire_events.length, 0);

  const approved = await make(1);
  await pendingReceipt(approved.step);
  await deliver(); await deliver();
  let snapshot = await state();
  noBookingEffects(snapshot, approved.request);
  assert.equal(calendarWrites(snapshot).length, 0, "pending approval never reaches Google's event or conference creation API");
  assert.equal(snapshot.wire_events.length, 0);
  const anonymous = await fetch(process.env.DIAL_REVIEW_ORIGIN + `/api/app/booking-approvals/${approved.request.id}/decision`, {
    method: "POST", headers: { origin: process.env.DIAL_REVIEW_ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ decision: "approve" }),
  });
  assert.equal(anonymous.status, 401);
  noBookingEffects(await state(), approved.request);
  assert.equal(calendarWrites(await state()).length, 0, "an unauthenticated approval cannot create a conference");

  await data(`/api/app/booking-approvals/${approved.request.id}/decision`, { decision: "approve" });
  await call(`/api/app/booking-approvals/${approved.request.id}/decision`, { decision: "approve" }, 409);
  await call(`/api/app/booking-approvals/${approved.request.id}/decision`, { decision: "decline" }, 409);
  const waiting = await data(manage(approved.step));
  assert.equal(waiting.state, "confirmed");
  assert.equal(waiting.calendarState, "pending");
  assert.equal(waiting.meetingState, "pending");
  assert.equal(waiting.location.state, "pending");
  assert.equal(waiting.location.value, undefined, "the joining link stays pending until the provider returns it");
  snapshot = await state();
  const upserts = snapshot.delivery_outbox.filter(row => row.booking_id === approved.request.booking_id && row.kind === "calendar_upsert");
  assert.equal(upserts.length, 1, "approval queues one managed event");
  assert.ok(snapshot.delivery_outbox.some(row => row.booking_id === approved.request.booking_id && row.kind === "reminder"), "approval schedules reminders");
  await deliver();
  snapshot = await state();
  const writes = calendarWrites(snapshot);
  assert.equal(writes.length, 1, "approval creates exactly one provider event and conference");
  assert.equal(writes[0].method, "POST");
  assert.equal(new URL(writes[0].url).searchParams.get("conferenceDataVersion"), "1");
  const inserted = JSON.parse(writes[0].body);
  assert.ok(inserted.conferenceData?.createRequest, "approval requests a Google Meet conference in the provider write");
  const create = inserted.conferenceData.createRequest;
  assert.equal(create.conferenceSolutionKey.type, "hangoutsMeet");
  assert.ok(create.requestId);
  assert.equal(create.requestId, upserts[0].idempotency_key, "conference creation uses the queued operation's stable key");
  assert.equal(create.requestId, inserted.extendedProperties.private["dial-idempotency-key"], "conference creation uses the managed event's durable identity");
  assert.equal(inserted.extendedProperties.private["dial-booking-id"], approved.request.booking_id);
  assert.deepEqual(inserted.attendees, [{ email: approved.payload.email }]);
  assert.equal(snapshot.wire_events.length, 1);
  const providerEvent = JSON.parse(snapshot.wire_events[0].payload);
  assert.equal(providerEvent.id, inserted.id);
  assert.equal(providerEvent.conferenceData.createRequest.requestId, create.requestId);
  const joiningLink = providerEvent.conferenceData.entryPoints.find(point => point.entryPointType === "video").uri;
  assert.equal(joiningLink, "https://meet.google.com/aaa-bbbb-ccc");
  const booking = snapshot.bookings.find(row => row.id === approved.request.booking_id);
  assert.equal(booking.calendar_provider_event_id, inserted.id);
  assert.equal(booking.meeting_url, joiningLink);
  const ready = await data(manage(approved.step));
  assert.equal(ready.state, "confirmed");
  assert.equal(ready.calendarState, "succeeded");
  assert.equal(ready.meetingState, "succeeded");
  assert.deepEqual(ready.location, { label: "Google Meet", state: "ready", value: joiningLink });
  const confirmations = snap => bookingMail(snap, approved.request.booking_id).filter(mail => /^Confirmed:/.test(mail.subject) && recipient(mail).includes(approved.payload.email));
  assert.equal(confirmations(snapshot).length, 1, "approval sends one ordinary invitee confirmation");
  assert.equal(bookingMail(snapshot, booking.id).filter(mail => /^New booking:/.test(mail.subject)).length, 1, "approval sends one ordinary host confirmation");
  // Deliver the completed calendar and mail commands again, as a duplicate Queue delivery would.
  const completed = snapshot.delivery_outbox.filter(row => row.booking_id === booking.id && ["calendar_upsert", "mail_send"].includes(row.kind) && row.state === "succeeded");
  assert.ok(completed.some(row => row.id === upserts[0].id));
  const callsBeforeReplay = snapshot.wire_calls.length;
  for (const command of completed) {
    await data("/__fixtures/deliver", { id: command.id });
    await data("/__fixtures/deliver", { id: command.id });
  }
  await deliver();
  snapshot = await state();
  assert.equal(snapshot.wire_calls.length, callsBeforeReplay, "duplicate deliveries contact neither Google nor mail again");
  assert.deepEqual(calendarWrites(snapshot), writes, "repeated delivery retains the single stable conference-create request");
  assert.equal(snapshot.wire_events.length, 1);
  assert.equal(confirmations(snapshot).length, 1);
  assert.deepEqual((await data(manage(approved.step))).location, ready.location);

  for (const decision of ["declined", "expired"]) {
    const closed = await make(decision === "declined" ? 2 : 3);
    await pendingReceipt(closed.step);
    await deliver();
    noBookingEffects(await state(), closed.request);
    assert.deepEqual(calendarWrites(await state()), writes, "another pending request creates no provider event or conference");
    if (decision === "declined") {
      await data(`/api/app/booking-approvals/${closed.request.id}/decision`, { decision: "decline" });
      await call(`/api/app/booking-approvals/${closed.request.id}/decision`, { decision: "decline" }, 409);
    } else {
      await call("/__fixtures/approval-expiry", { id: closed.request.id }, 204);
      await call("/__fixtures/approval-expiry", { id: closed.request.id }, 204);
    }
    await call(`/api/app/booking-approvals/${closed.request.id}/decision`, { decision: "approve" }, 409);
    const replay = await data(`${base}/confirm`, closed.payload, 202);
    assert.equal(replay.approval.url, closed.step.approval.url, "replaying a closed submission retains its original request");
    await deliver(); await deliver();
    snapshot = await state();
    noBookingEffects(snapshot, closed.request);
    assert.deepEqual(calendarWrites(snapshot), writes, `${decision} creates neither a provider event nor a conference`);
    assert.equal(snapshot.wire_events.length, 1);
    const receipt = await data(manage(closed.step));
    assert.equal(receipt.state, decision);
    assert.equal(receipt.meetingState, "not_required");
    assert.equal(receipt.location.value, undefined);
    assert.ok((await slots()).slots.some(slot => slot.startAt === closed.payload.startAt), `${decision} releases the slot`);
    const notices = wireMail(snapshot).filter(mail => recipient(mail).includes(closed.payload.email) && mail.subject === `Booking request ${decision}: ${event.title}`);
    assert.equal(notices.length, 1, `${decision} sends one decision notice`);
    assert.ok(!textBody(notices[0]).includes(joiningLink), "a closed request never receives the approved booking's link");
  }
  checks.push("EVENT-008: pending requests have no Google event, conference, booking or reminders; only authenticated approval creates one managed event with one stable conference request and one ordinary confirmation; repeated decisions and deliveries repeat no effects; decline and expiry release the slot with one notice and no joining link, including after submission replay");
}
