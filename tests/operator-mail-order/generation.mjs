import assert from "node:assert/strict";

export async function verifyRecipientGenerations({ context, data, sql, email, getOperatorId, remove, invite, control, release, waitReached, processOne, calls }) {
  async function acrossReinvitation(produce) {
    const previousId = getOperatorId();
    await control("recipients");
    const producing = produce();
    try {
      await waitReached(); await remove(); await invite();
      assert.notEqual(getOperatorId(), previousId);
    } finally {
      await release();
      try { await producing; } finally { await control(null); }
    }
    assert.deepEqual(await sql("SELECT id FROM oa_operators WHERE id = ?", [previousId]), []);
    return previousId;
  }
  const operatorRows = (clause, values = []) => sql(`SELECT * FROM delivery_outbox WHERE json_extract(payload_json,'$.to') = ? AND json_extract(payload_json,'$.recipientRole') = 'operator' AND ${clause}`, [email, ...values]);
  async function absent(rows) {
    const outcomes = rows.map(row => `${row.state}:${row.last_error_code}`).join(", ");
    assert.equal(rows.length, 0, `a delayed recipient selection cannot recreate erased personal mail; retained outcomes: ${outcomes}`);
  }
  async function freshOperator(rows) {
    assert.ok(rows.length > 0, "a current native recipient still receives mail");
    for (const row of rows) assert.equal(JSON.parse(row.payload_json).operatorAccess.id, getOperatorId());
  }

  await context.test("a delayed real connection-recipient SELECT cannot recreate erased recipient mail", async () => {
    await acrossReinvitation(() => data("/__order/alert", { cycle: 401 }));
    await absent(await operatorRows("idempotency_key LIKE 'connection:resend:unhealthy:401:%'"));
    await data("/__order/alert", { cycle: 402 });
    const rows = await operatorRows("idempotency_key LIKE 'connection:resend:unhealthy:402:%'");
    await freshOperator(rows);
    assert.equal((await processOne(rows[0].id)).result, "succeeded");
  });

  const event = await data("/api/public/events/dial-host/intro");
  const week = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const offers = await data(`/api/public/book/dial-host/intro/availability?week=${week}&inviteeTimezone=UTC`);
  const slot = offers.slots.find((item) => Date.parse(item.startAt) > Date.now() + 2 * 86400000);
  assert.ok(slot);
  let bookingId;
  await context.test("booking confirmations and both reminders reject an erased recipient selected before their transaction", async () => {
    const selection = await data("/api/public/book/dial-host/intro/selection", { startAt: slot.startAt, inviteeTimezone: "UTC" }, "POST", 201);
    await acrossReinvitation(() => data("/api/public/book/dial-host/intro/confirm", { nonce: selection.nonce, startAt: slot.startAt, inviteeTimezone: "UTC", name: "Admission snapshot invitee", email: "booking-order-invitee@example.test", answers: { [event.eventType.questions[0].key]: "Generation proof" } }, "POST", 201));
    bookingId = (await sql("SELECT id FROM bookings WHERE invitee_name = 'Admission snapshot invitee'"))[0].id;
    await absent(await operatorRows("booking_id = ?", [bookingId]));
    const unaffected = await sql("SELECT * FROM delivery_outbox WHERE booking_id = ? AND json_extract(payload_json,'$.to') = ?", [bookingId, "owner@example.test"]);
    assert.equal(unaffected.length, 3, "the active owner receives a confirmation and both reminders");
    const [invitee] = await sql("SELECT * FROM delivery_outbox WHERE booking_id = ? AND kind = 'mail_send' AND json_extract(payload_json,'$.recipientRole') = 'invitee'", [bookingId]);
    assert.equal((await processOne(invitee.id)).result, "succeeded");
    assert.equal((await calls(invitee.idempotency_key)).length, 1);
  });

  await context.test("cancellation notices reject the erased recipient selected before their write transaction", async () => {
    assert.ok(bookingId, "the public confirmation committed the business record");
    await acrossReinvitation(() => data(`/api/app/bookings/${bookingId}/cancel`, { reason: "Native generation ordering" }));
    await absent(await operatorRows("booking_id = ? AND json_extract(payload_json,'$.bookingState') = 'cancelled'", [bookingId]));
    assert.equal((await sql("SELECT state FROM bookings WHERE id = ?", [bookingId]))[0].state, "cancelled");
    const unaffected = await sql("SELECT json_extract(payload_json,'$.to') AS email FROM delivery_outbox WHERE booking_id = ? AND json_extract(payload_json,'$.bookingState') = 'cancelled'", [bookingId]);
    const recipients = await sql("SELECT email FROM operators WHERE removed_at IS NULL AND id <> ?", [getOperatorId()]);
    assert.deepEqual(unaffected.map(row => row.email).sort(), [...recipients.map(row => row.email), "booking-order-invitee@example.test"].sort(), "the invitee and every unaffected current operator retain cancellation mail");
  });

  await context.test("alternative-request notices cannot recreate a delayed erased recipient selection", async () => {
    const composition = { inviteeName: "Generation request", inviteeEmail: "request-order-invitee@example.test", inviteeTimezone: "UTC", note: "Delayed recipient read", windows: [{ date: week, startMinute: 780, endMinute: 840 }] };
    const review = await data("/api/public/events/dial-host/intro/request/review", composition, "POST", 201);
    await acrossReinvitation(() => data(`/api/public/events/dial-host/intro/request?nonce=${encodeURIComponent(review.nonce)}`, composition, "POST", 201));
    const request = (await sql("SELECT id FROM availability_requests WHERE invitee_name = 'Generation request'"))[0];
    await absent(await operatorRows("request_id = ?", [request.id]));
    const unaffected = await sql("SELECT json_extract(payload_json,'$.to') AS email FROM delivery_outbox WHERE request_id = ?", [request.id]);
    const recipients = await sql("SELECT email FROM operators WHERE removed_at IS NULL AND id <> ?", [getOperatorId()]);
    assert.deepEqual(unaffected.map(row => row.email).sort(), [...recipients.map(row => row.email), composition.inviteeEmail].sort(), "the native request and every unaffected recipient command commit together");
    const [invitee] = await sql("SELECT * FROM delivery_outbox WHERE request_id = ? AND json_extract(payload_json,'$.recipientRole') = 'invitee'", [request.id]);
    assert.equal((await processOne(invitee.id)).result, "succeeded");
    assert.equal((await calls(invitee.idempotency_key)).length, 1);
  });
}
