import assert from "node:assert/strict";

/** Public-door erasure probes; only Stripe's HTTP edge supplies a refusal or completes Checkout. */
export async function paymentErasureProbes({ data, call, state, hold, slot, day, webhook, stripeEvent, coaching, probe }) {
  const objects = snapshot => snapshot.wire_stripe_objects.map(row => JSON.parse(row.payload));
  const erase = async email => {
    const preview = await data("/api/app/privacy/preview", { email });
    return data("/api/app/privacy/erase", { email, confirmation: preview.confirmation, expiresAt: preview.expiresAt });
  };
  await probe("erasure does not count a refused invoice Customer", async () => {
    const email = "synthetic-dial-erasure-invoice@example.test", name = "Synthetic erasure invoice";
    const booking = await data("/api/app/bookings", { eventTypeId: coaching.id, startAt: await slot("coaching", day(24)), inviteeTimezone: "UTC", name, email, answers: {} }, 201);
    const before = objects(await state()).filter(object => object.object === "customer").length;
    await data("/wire/control", { name: "stripe-customer-refused", value: 1 });
    try {
      const response = await call(`/api/app/bookings/${booking.id}/invoice`, {}, 503);
      assert.equal((await response.json()).error.code, "invoice_failed");
    } finally { await data("/wire/control", { name: "stripe-customer-refused", value: 0 }); }
    assert.equal(objects(await state()).filter(object => object.object === "customer").length, before, "Stripe refused before creating a Customer");
    const receipt = await erase(email);
    assert.equal(receipt.localComplete, true);
    assert.ok(Array.isArray(receipt.externalRequests), "DATA-007 lists individual processor erasure requests");
    assert.equal(receipt.stripeCustomersRetained, 0, "a refused invoice attempt created no retained Customer");
    assert.equal(receipt.stripeCustomersNotice, null);
    assert.equal(receipt.stripeSessionsRetained, 0);
    assert.equal((await state()).wire_calls.filter(row => row.method === "DELETE" && new URL(row.url).pathname.startsWith("/v1/customers/")).length, 0, "no deletion is requested for a Customer that never existed");
    const rows = await data("/__fixtures/payments/all-rows");
    assert.equal(rows.bookings.some(row => row.id === booking.id), false);
    assert.equal(rows.payment_movements.some(row => row.booking_id === booking.id), false);
    assert.equal(JSON.stringify(rows).includes(email), false);
    assert.equal(JSON.stringify(rows).includes(name), false);
  });
  await probe("erasure counts a Customer created before invoice refusal", async () => {
    const email = "synthetic-dial-erasure-draft@example.test", name = "Synthetic erasure draft";
    const booking = await data("/api/app/bookings", { eventTypeId: coaching.id, startAt: await slot("coaching", day(26)), inviteeTimezone: "UTC", name, email, answers: {} }, 201);
    const before = objects(await state()).filter(object => object.object === "customer").length;
    await data("/wire/control", { name: "stripe-invoice-refused", value: 1 });
    try { await call(`/api/app/bookings/${booking.id}/invoice`, {}, 503); }
    finally { await data("/wire/control", { name: "stripe-invoice-refused", value: 0 }); }
    assert.equal(objects(await state()).filter(object => object.object === "customer").length, before + 1);
    const receipt = await erase(email);
    assert.equal(receipt.stripeCustomersRetained, 1, "invoice failure does not undo successful Customer creation");
    assert.equal(receipt.localComplete, true);
    const rows = JSON.stringify(await data("/__fixtures/payments/all-rows"));
    assert.equal(rows.includes(email), false);
    assert.equal(rows.includes(name), false);
  });
  await probe("erasure reconciles Checkout paid before its webhook without confirming", async () => {
    const email = "synthetic-dial-erasure-checkout@example.test", name = "Synthetic erasure Checkout";
    const pending = await hold("coaching", await slot("coaching", day(25)), email, name, true);
    const paid = await data("/__fixtures/payments/pay", { sessionId: pending.sessionId });
    assert.equal(paid.payment_status, "paid");
    assert.ok(paid.customer, "Checkout actually created a Customer for the consented saved card");
    const before = await state();
    const createdCustomers = objects(before).filter(object => object.object === "customer" && object.email === email);
    const createdSessions = before.wire_stripe_sessions.filter(row => JSON.parse(row.payload).customer_email === email);
    assert.equal(createdCustomers.length, 1); assert.equal(createdSessions.length, 1);
    const nativeHold = before.payment_holds.find(row => row.checkout_session_id === pending.sessionId);
    assert.ok(nativeHold && nativeHold.state === "held");
    assert.equal(before.bookings.some(row => row.invitee_email === email), false, "Stripe has been paid but its webhook has not confirmed a booking");
    const nonce = before.booking_nonces.find(row => row.id === nativeHold.nonce_id);
    assert.ok(nonce?.payload_hash, "the consumed selection carries a personal composition hash");
    const controls = before.bookings.map(row => [row.id, row.invitee_email]);
    const receipt = await erase(email);
    assert.equal(receipt.localComplete, true);
    assert.equal(receipt.stripeCustomersRetained, createdCustomers.length, "count the Customer Checkout created before the booking existed");
    assert.equal(receipt.stripeSessionsRetained, createdSessions.length, "count the actual retained Checkout Session");
    assert.equal(receipt.savedCardsDetached, 1);
    assert.equal(receipt.savedCardFailures, 0);
    await call(`/api/public/payments/${pending.returnToken}`, undefined, 404);
    const assertGone = async () => {
      const rows = await data("/__fixtures/payments/all-rows"), serialized = JSON.stringify(rows);
      assert.equal(rows.payment_holds.some(row => row.id === nativeHold.id), false);
      assert.equal(rows.booking_nonces.some(row => row.id === nonce.id), false);
      for (const marker of [email, name, nonce.payload_hash, paid.customer]) assert.equal(serialized.includes(marker), false, "erased pending payer data must not survive or return");
      assert.deepEqual(rows.bookings.map(row => [row.id, row.invitee_email]), controls, "no booking is confirmed or unrelated booking changed");
    };
    await assertGone();
    const event = stripeEvent("checkout.session.completed", paid);
    await webhook(event); await webhook(event);
    const provider = objects(await state()), intent = provider.find(object => object.id === paid.payment_intent);
    assert.ok(intent);
    await webhook(stripeEvent("payment_intent.succeeded", intent));
    await assertGone();
    const after = objects(await state());
    const refunds = after.filter(object => object.object === "refund" && object.payment_intent === paid.payment_intent);
    assert.deepEqual(refunds.map(refund => [refund.status, refund.amount]), [["succeeded", paid.amount_total]], "erasure and duplicate late events refund the capture exactly once");
    assert.equal(after.find(object => object.id === paid.payment_intent).amount_refunded, paid.amount_total);
    const audit = (await state()).anonymized_audit.find(row => row.processor_ref === refunds[0].id);
    assert.equal(audit?.actor_type, "operator");
    assert.ok(audit?.actor_id && audit.reason, "the anonymous refund retains its acting operator and explicit reason");
    const card = after.find(object => object.object === "payment_method" && object.id === intent.payment_method);
    assert.equal(card?.customer, null, "the pending payer's saved card was detached");
  });
}
