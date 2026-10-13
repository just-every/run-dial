import assert from "node:assert/strict";
import { build } from "esbuild";
import { contract } from "./contract.mjs";
import { receiptDatabase } from "./request-receipt/database.mjs";

const bundle = await build({ entryPoints: [new URL("./request-receipt/fixture.ts", import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm" });
const { receiptApp } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const base = "/api/public/events/maya-chen/conversation/request";
const composition = { inviteeName: "Avery Invitee", inviteeEmail: "avery@example.test", inviteeTimezone: "UTC", note: "Afternoons please", windows: [{ date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), startMinute: 780, endMinute: 840 }] };
const post = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function fixture(context) {
  const database = await receiptDatabase(context);
  const app = receiptApp(database.binding);
  const issue = async () => {
    const response = await app.request(`${base}/review`, post(composition));
    assert.equal(response.status, 201, "native review issues the capability");
    return (await response.json()).nonce;
  };
  const submit = async () => {
    const nonce = await issue();
    assert.equal((await app.request(`${base}?nonce=${encodeURIComponent(nonce)}`, post(composition))).status, 201, "native submit persists the request and mail commands");
    return nonce;
  };
  const read = async (nonce, status, acknowledgement, path = base) => {
    const before = database.snapshot();
    const response = await app.request(`${path}/receipt${nonce === undefined ? "" : `?nonce=${encodeURIComponent(nonce)}`}`);
    assert.equal(response.status, status, "receipt status");
    assert.equal(response.headers.get("cache-control"), "no-store");
    if (status === 200) assert.deepEqual(await response.json(), { acknowledgement }, "receipt exposes only acknowledgement state");
    assert.equal(database.snapshot(), before, "receipt reads preserve every row in every persisted table");
    return response;
  };
  return { ...database, app, issue, submit, read };
}

contract("REQUEST-005", "receipt reports only the original invitee acknowledgement command's persisted outcome", async (context) => {
  const f = await fixture(context);
  const nonce = await f.submit();
  const command = f.sqlite.prepare("SELECT id, request_id FROM delivery_outbox WHERE idempotency_key LIKE '%:invitee:ack'").get();
  assert.ok(command);
  f.sqlite.exec("UPDATE delivery_outbox SET state='succeeded' WHERE idempotency_key LIKE '%:operator:%'");
  await f.read(nonce, 200, "queued");
  f.sqlite.prepare("UPDATE delivery_outbox SET state='processing',attempts=1 WHERE id=?").run(command.id);
  await f.read(nonce, 200, "queued");
  f.sqlite.prepare("UPDATE delivery_outbox SET state='succeeded',succeeded_at='2026-01-01T01:00:00Z' WHERE id=?").run(command.id);
  await f.read(nonce, 200, "sent");
  f.sqlite.prepare("UPDATE delivery_outbox SET state='failed',last_error_code='mail_outcome_unknown' WHERE id=?").run(command.id);
  await f.read(nonce, 200, "failed");
  f.sqlite.prepare("UPDATE delivery_outbox SET last_error_code='bounced' WHERE id=?").run(command.id);
  await f.read(nonce, 200, "failed");
  f.sqlite.exec("UPDATE availability_request_review_nonces SET expires_at='2000-01-01T00:00:00Z'");
  await f.read(nonce, 200, "failed");
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM availability_requests").get().n, 1);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM delivery_outbox WHERE idempotency_key LIKE '%:invitee:ack'").get().n, 1);
});

contract("AUTH-002", "receipt capability denies malformed, unknown, unconsumed, expired and cross-event nonce access without effects", async (context) => {
  const f = await fixture(context);
  const nonce = await f.submit();
  const unused = await f.issue();
  for (const malformed of [undefined, "", "short", "!".repeat(43), "a".repeat(129)]) await f.read(malformed, 400);
  await f.read("x".repeat(43), 404);
  await f.read(unused, 404);
  f.sqlite.exec("UPDATE availability_request_review_nonces SET expires_at='2000-01-01T00:00:00Z' WHERE consumed_at IS NULL");
  await f.read(unused, 410);
  for (const value of [nonce, unused]) {
    await f.read(value, 404, undefined, "/api/public/events/maya-chen/different-event/request");
    await f.read(value, 404, undefined, "/api/public/events/wrong-host/conversation/request");
  }
  const original = f.sqlite.prepare("SELECT request_id FROM availability_request_review_nonces WHERE consumed_at IS NOT NULL").get().request_id;
  const otherNonce = await f.submit();
  const other = f.sqlite.prepare("SELECT id FROM availability_requests WHERE id<>?").get(original).id;
  f.sqlite.prepare("UPDATE availability_request_review_nonces SET request_id=? WHERE request_id=?").run(other, original);
  await f.read(nonce, 404);
  await f.read(otherNonce, 200, "queued");
});

contract("BASE-PUBLIC-001", "receipt reads are private, inert, and unavailable for disabled or erased records", async (context) => {
  const f = await fixture(context);
  const nonce = await f.submit();
  for (const status of ["draft", "disabled"]) {
    f.sqlite.prepare("UPDATE event_types SET status=? WHERE id='event-one'").run(status);
    await f.read(nonce, 404);
  }
  f.sqlite.exec("UPDATE event_types SET status='published',alternative_requests_enabled=0 WHERE id='event-one'");
  await f.read(nonce, 404);
  f.sqlite.exec("UPDATE event_types SET alternative_requests_enabled=1 WHERE id='event-one'");
  const row = f.sqlite.prepare("SELECT id,event_type_id,composition_hash FROM availability_requests").get();
  f.sqlite.prepare("UPDATE availability_requests SET event_type_id='event-two' WHERE id=?").run(row.id);
  await f.read(nonce, 404);
  f.sqlite.prepare("UPDATE availability_requests SET event_type_id=?,composition_hash='wrong' WHERE id=?").run(row.event_type_id, row.id);
  await f.read(nonce, 404);
  f.sqlite.prepare("UPDATE availability_requests SET composition_hash=? WHERE id=?").run(row.composition_hash, row.id);
  f.sqlite.exec("DELETE FROM delivery_outbox WHERE idempotency_key LIKE '%:invitee:ack'");
  await f.read(nonce, 404);
  f.sqlite.exec("DELETE FROM availability_requests");
  await f.read(nonce, 404);
});
