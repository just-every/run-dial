import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

/** Render the actual delivered cancellation email, after a native paid booking and host cancellation. */
export async function cancellationMailScreens({ browser, owner, origin, folder, event }) {
  const headers = { Origin: origin }, email = "synthetic-dial-cancellation@example.test";
  const json = async (response, status = 200) => { assert.equal(response.status(), status); return response.json(); };
  const post = async (path, data, status = 200) => json(await owner.request.post(origin + path, { headers, data }), status);
  const base = `/api/public/book/dial-host/${event.slug}`, week = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const startAt = (await json(await owner.request.get(`${origin}${base}/availability?week=${week}&durationMinutes=60`))).slots[0].startAt;
  const selection = await post(base + "/selection", { startAt, inviteeTimezone: "UTC", durationMinutes: 60 }, 201);
  const shown = (await json(await owner.request.get(`${origin}${base}/selection?${new URLSearchParams({ nonce: selection.nonce, startAt, inviteeTimezone: "UTC" })}`))).payment;
  const step = await post(base + "/confirm", { nonce: selection.nonce, startAt, inviteeTimezone: "UTC", durationMinutes: 60, name: "Avery Consultation", email, answers: {}, cardConsent: { accepted: true, version: shown.consent.version } }, 202);
  const paid = await post("/__fixtures/payments/pay", { sessionId: new URL(step.payment.checkoutUrl).pathname.split("/").at(-1) });
  const body = JSON.stringify({ id: `synthetic-dial-${randomUUID()}`, type: "checkout.session.completed", account: "acct_wirehost", data: { object: paid } });
  const timestamp = Math.floor(Date.now() / 1000), signature = createHmac("sha256", "whsec_wiretest").update(`${timestamp}.${body}`).digest("hex");
  assert.equal((await owner.request.post(origin + "/api/webhooks/stripe", { headers: { "stripe-signature": `t=${timestamp},v1=${signature}`, "content-type": "application/json" }, data: body })).status(), 200);
  const booking = (await json(await owner.request.get(origin + "/api/app/bookings"))).find(row => row.inviteeEmail === email);
  await post(`/api/app/bookings/${booking.id}/cancel`, { reason: "Host travel" });
  await post("/__fixtures/deliver", {}); await post("/__fixtures/deliver", {});
  const messages = (await json(await owner.request.get(origin + "/__fixtures/status"))).fixture_mail.map(row => JSON.parse(row.message_json));
  const notes = messages.filter(row => row.to === email && /^Booking cancelled:/.test(row.subject));
  assert.equal(notes.length, 1); assert.equal(notes[0].text.split("$217.75 USD").length - 1, 1);
  for (const width of [1440, 390]) {
    const context = await browser.newContext(), page = await context.newPage();
    try {
      await page.setViewportSize({ width, height: 900 }); await page.setContent(notes[0].html);
      assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth + 1));
      await page.screenshot({ path: `${folder}/cancellation-email-${width}.png`, fullPage: true });
    } finally { await context.close(); }
  }
}
