import assert from "node:assert/strict";
import { bookingMail, textBody, recipient } from "./mail-contracts.mjs";

/** All ordering comes from an entered/released Stripe barrier, never from elapsed time. */
export async function cancellationProbes({ data, call, state, hold, complete, slot, day, webhook, stripeEvent, sessionOf, deliver, coaching }) {
  const failures = [];
  for (const kind of ["checkout", "balance", "invoice"]) for (const order of ["event-first", "cancel-first", "during-cancel"]) {
    const name = `${kind}-${order}`, email = `synthetic-dial-${name}@example.test`;
    let booking, paid, initial, event;
    if (kind === "invoice") {
      booking = await data("/api/app/bookings", { eventTypeId: coaching.id, startAt: await slot("coaching", day(26)), inviteeTimezone: "UTC", name: `synthetic-dial-${name}`, email, answers: {} }, 201);
      const invoice = (await data(`/api/app/bookings/${booking.id}/invoice`, {})).invoice;
      paid = await data("/__fixtures/payments/pay-invoice", { invoiceId: invoice.id });
      event = stripeEvent("invoice.paid", paid);
    } else {
      const held = await hold("coaching", await slot("coaching", day(25)), email, `synthetic-dial-${name}`, true);
      ({ booking, paid: initial } = await complete(held));
      paid = initial;
      if (kind === "balance") {
        const returned = await data(`/api/public/payments/${held.returnToken}`);
        const manage = new URL(returned.manageUrl).pathname.split("/").at(-1);
        const balance = new URL((await data(`/api/public/manage/${manage}`)).payment.balanceUrl).pathname.split("/").at(-1);
        const checkout = await data(`/api/public/payments/balance/${balance}`, {});
        paid = await data("/__fixtures/payments/pay", { sessionId: sessionOf(checkout.checkoutUrl) });
      }
      event = stripeEvent("checkout.session.completed", paid);
    }
    const refs = [...new Set([initial?.payment_intent, paid.payment_intent].filter(Boolean))];
    if (order === "event-first") await webhook(event);
    if (order === "during-cancel") {
      const path = kind === "invoice" ? `/v1/invoices/${paid.id}/void` : "/v1/refunds";
      await data("/__fixtures/payments/gate", { action: "arm", name, path });
      const cancelling = call(`/api/app/bookings/${booking.id}/cancel`, {});
      await data("/__fixtures/payments/gate", { action: "entered", name });
      try { await webhook(event); }
      finally { await data("/__fixtures/payments/gate", { action: "release", name }); }
      await cancelling;
    } else await call(`/api/app/bookings/${booking.id}/cancel`, {});
    await webhook(event); await webhook(event);
    await call(`/api/app/bookings/${booking.id}/cancel`, {});
    await deliver();
    try {
      const snap = await state(), objects = snap.wire_stripe_objects.map(row => JSON.parse(row.payload));
      const captured = objects.filter(row => refs.includes(row.id)).reduce((total, row) => total + row.amount_received, 0);
      const refunds = objects.filter(row => row.object === "refund" && refs.includes(row.payment_intent));
      assert.equal(refunds.reduce((total, row) => total + row.amount, 0), captured, `${name}: Stripe refunds every captured cent`);
      for (const ref of refs) assert.equal(refunds.filter(row => row.payment_intent === ref).length, 1, `${name}: one refund per capture`);
      const calls = snap.wire_calls.filter(row => new URL(row.url).pathname === "/v1/refunds" && refs.includes(JSON.parse(row.body).payment_intent));
      assert.ok(calls.every(row => typeof JSON.parse(row.headers).idempotency === "string" && JSON.parse(row.headers).idempotency.length > 0), `${name}: every refund has an idempotency key`);
      assert.equal(new Set(calls.map(row => JSON.parse(row.headers).idempotency)).size, refs.length, `${name}: one key per refund`);
      const money = (await data(`/api/app/bookings/${booking.id}/money`)).money;
      assert.equal(money.ledger.refundedCents, captured, `${name}: Dial ledger matches Stripe`);
      assert.equal(snap.bookings.find(row => row.id === booking.id).state, "cancelled");
      const notices = bookingMail(snap, booking.id).filter(mail => /^Booking cancelled:/.test(mail.subject) && recipient(mail).includes(email));
      assert.equal(notices.length, 1, `${name}: one invitee cancellation notice`);
      const text = textBody(notices[0]);
      const knownCaptured = kind === "checkout" ? initial.amount_total : order === "event-first" ? captured : initial?.amount_total ?? 0;
      if (knownCaptured) {
        const shown = `$${(knownCaptured / 100).toFixed(2)} USD`;
        assert.equal(text.split(shown).length - 1, 1, `${name}: cancellation mail states its refund amount once`);
      } else assert.ok(text.includes("nothing was paid"), `${name}: no unobserved captured amount is claimed in mail`);
    } catch (error) { failures.push(`${name}: ${error.message}`); }
  }
  assert.deepEqual(failures, [], "all captured money is refunded once across cancellation orders");
  console.log("PROBE cancellation settling payments: PASS (nine deterministic orders)");
}
