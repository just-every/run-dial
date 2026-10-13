import assert from "node:assert/strict";

export function assertReminderCadence(snapshot, bookingId, startAt, recipients) {
  const booking = snapshot.bookings.find(row => row.id === bookingId);
  assert.ok(booking, "reminders belong to the persisted booking");
  const occurrence = snapshot.booking_occurrences.find(row => row.id === booking.current_occurrence_id);
  assert.ok(occurrence, "reminders belong to the booking's current occurrence");
  assert.equal(occurrence.booking_id, bookingId);
  assert.equal(Date.parse(occurrence.start_at), Date.parse(startAt), "the current occurrence matches the public receipt");
  const reminders = snapshot.delivery_outbox.filter(row => row.booking_id === bookingId && row.kind === "reminder");
  const current = reminders.filter(row => row.occurrence_id === occurrence.id);
  assert.equal(current.length, recipients.length * 2, "each recipient has exactly two reminders for the current occurrence");
  for (const { to, recipientRole } of recipients) {
    const copies = current.filter(row => {
      const payload = JSON.parse(row.payload_json);
      return payload.to === to && payload.recipientRole === recipientRole;
    });
    assert.deepEqual(copies.map(row => (Date.parse(occurrence.start_at) - Date.parse(row.next_attempt_at)) / 3600000).sort((a, b) => a - b), [1, 24], `${recipientRole} ${to} has one reminder at each of 1 and 24 hours before the current start`);
    assert.ok(copies.every(row => row.state === "pending"), "future reminders await their scheduled time");
  }
  assert.ok(reminders.filter(row => row.occurrence_id !== occurrence.id).every(row => ["succeeded", "failed"].includes(row.state)), "no reminder for a stale occurrence remains scheduled or in flight");
  return current;
}
