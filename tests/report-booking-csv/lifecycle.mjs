import assert from "node:assert/strict";
import { confirmAuthLink, localMagicLink } from "../auth-client.mjs";

/** Exercise export authority and erased captures through native HTTP doors. */
export async function csvLifecycle(runtime, { eventId, exportIds, snapshot }) {
  const endpoint = "/api/app/reports/bookings.csv";
  const integration = await runtime.data("/api/app/api-credentials", {
    name: "Synthetic CSV reader", scopes: ["reports:read"],
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  }, 201);
  const beforeRefusals = await snapshot();
  const bearer = await runtime.api(endpoint, { headers: { cookie: "", Authorization: `Bearer ${integration.secret}` } });
  assert.equal(bearer.status, 401, "a reports credential cannot replace an owner session for CSV export");
  assert.equal((await bearer.json()).error.code, "session_required");
  const ownerCsv = await runtime.api(endpoint);
  assert.equal(ownerCsv.status, 200);
  assert.ok(!(await ownerCsv.text()).includes(integration.secret), "the integration secret never enters an owner CSV");

  const email = ["synthetic-dial-csv-991", "dial.test"].join("@");
  const memberId = "synthetic-dial-csv-991";
  await runtime.db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) VALUES(?,?,'Synthetic CSV member','member','active',1,?)")
    .bind(memberId, email, Date.now()).run();
  const signIn = async () => {
    const requested = await runtime.api("/auth/magic-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, returnTo: "/app" }) });
    assert.equal(requested.status, 202);
    const { developmentLink } = await localMagicLink(new URL(requested.url).origin);
    const signed = await confirmAuthLink(developmentLink);
    assert.equal(signed.status, 303);
    return signed.headers.get("set-cookie").split(";")[0];
  };
  const memberCookie = await signIn();
  const member = await runtime.api(endpoint, { headers: { cookie: memberCookie } });
  assert.equal(member.status, 403);
  assert.equal((await member.json()).error.code, "role_forbidden");
  await runtime.db.prepare("UPDATE oa_operators SET role='admin' WHERE id=?").bind(memberId).run();
  assert.equal((await runtime.api(endpoint, { headers: { cookie: memberCookie } })).status, 401, "a role change invalidates the old native session");
  const admin = await runtime.api(endpoint, { headers: { cookie: await signIn() } });
  assert.equal(admin.status, 403, "the interim export floor remains owner-only");
  assert.equal((await admin.json()).error.code, "role_forbidden");
  assert.deepEqual(await snapshot(), beforeRefusals, "refused export authority never changes product or credential rows");
  console.log("PROBE REPORT-003 authority: owner CSV 200; reports credential 401; member and admin 403; stale role session 401; product rows unchanged");

  const root = "/api/public/book/dial-host/intro";
  const event = await runtime.data(`/api/app/event-types/${eventId}`);
  const week = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const available = await runtime.data(`${root}/availability?${new URLSearchParams({ week, inviteeTimezone: "UTC" })}`);
  assert.ok(available.slots.length > 0, "the native public booking door offers a real slot");
  const startAt = available.slots[0].startAt;
  const selection = await runtime.data(`${root}/selection`, { startAt, inviteeTimezone: "UTC" }, 201);
  const person = ["synthetic-dial-csv-992", "dial.test"].join("@");
  const capture = { nonce: selection.nonce, startAt, inviteeTimezone: "UTC", name: "Synthetic CSV lifecycle", email: person,
    answers: Object.fromEntries(event.questions.map(question => [question.key, "synthetic-dial-private-992"])) };
  const booked = await runtime.data(`${root}/confirm`, capture, 201);
  const query = new URLSearchParams({ query: person });
  assert.deepEqual(await exportIds(query), [booked.bookingReference], "a publicly confirmed booking appears in the filtered CSV");
  const response = await runtime.api(`${endpoint}?${query}`);
  assert.equal(response.status, 200);
  const csv = await response.text();
  const manageToken = new URL(booked.manageUrl).pathname.split("/").at(-1);
  for (const secret of [capture.nonce, manageToken, "synthetic-dial-private-992"]) assert.ok(!csv.includes(secret), "native booking capabilities and private answers stay out of the CSV");
  const preview = await runtime.data("/api/app/privacy/preview", { email: person });
  assert.equal(preview.bookings, 1);
  const receipt = await runtime.data("/api/app/privacy/erase", { email: person, confirmation: preview.confirmation, expiresAt: preview.expiresAt });
  assert.equal(receipt.localComplete, true);
  const afterErase = await snapshot();
  assert.deepEqual(await exportIds(query), [], "erasing a person removes their exported booking");
  const replay = await runtime.data(`${root}/confirm`, capture, 404);
  assert.equal(replay.error.code, "booking_nonce_not_found");
  assert.deepEqual(await exportIds(query), [], "replaying the captured public confirmation cannot revive exportable personal data");
  assert.deepEqual(await snapshot(), afterErase, "replayed captures and repeated CSV reads leave the erased state unchanged");
  console.log("PROBE REPORT-003 erasure: public confirmation 201 -> CSV contains one booking without capabilities; native person erasure -> header-only CSV; captured confirmation replay 404; no resurrection");
}
