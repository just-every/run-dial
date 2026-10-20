import assert from "node:assert/strict";

/** CAL-006 journey 6c: native services and Google HTTP, including the next public availability read. */
export async function verifyConnectionResync(d, pass) {
  const syncs = snapshot => snapshot.wire_calls.filter(row => {
    const url = new URL(row.url);
    return row.method === "GET" && url.pathname.endsWith("/events") && url.searchParams.has("showDeleted") && !url.searchParams.has("privateExtendedProperty");
  });
  const busy = snapshot => snapshot.wire_calls.filter(row => new URL(row.url).pathname.endsWith("/freeBusy"));
  const expire = expiresAt => d.raw("/__fixtures/calendar-channel-expiry", { expiresAt }, 204);
  await d.slots(5);
  const before = await d.state();
  assert.ok(before.calendar_busy_read_windows.length > 0);
  await expire(new Date(Date.now() - 60_000).toISOString());
  await d.op("/api/app/calendar/check", {});
  const replaced = await d.state();
  assert.notEqual(replaced.calendar_push_channels[0].provider_channel_id, before.calendar_push_channels[0].provider_channel_id);
  const full = syncs(replaced).slice(syncs(before).length);
  assert.ok(full.length > 0 && !new URL(full[0].url).searchParams.has("syncToken"), "expired channel starts a full managed-event sync");
  assert.equal(replaced.calendar_busy_read_windows.length, 0, "replacement invalidates busy coverage");
  await d.slots(5);
  assert.ok(busy(await d.state()).length > busy(replaced).length, "next availability refetches busy time");

  await expire(new Date(Date.now() + 3_600_000).toISOString());
  const renewalBefore = await d.state();
  await d.op("/api/app/calendar/check", {});
  const renewed = await d.state();
  assert.notEqual(renewed.calendar_push_channels[0].provider_channel_id, renewalBefore.calendar_push_channels[0].provider_channel_id);
  assert.equal(renewed.calendar_connections[0].sync_cursor, renewalBefore.calendar_connections[0].sync_cursor);
  assert.equal(syncs(renewed).length, syncs(renewalBefore).length, "early renewal retains the incremental cursor");

  await expire(new Date(Date.now() + 3_600_000).toISOString());
  await d.wire("google-watch-status", 503);
  await d.raw("/api/app/calendar/check", {}, 503);
  assert.equal((await d.op("/api/app/calendar/connection")).reason, "push_channel_unrenewable");
  assert.equal((await d.state()).calendar_connections[0].sync_cursor, null);
  await d.wire("google-watch-status", 0);
  const failedWatch = await d.state();
  await d.slots(5);
  const recovered = await d.state();
  assert.ok(syncs(recovered).slice(syncs(failedWatch).length).some(row => !new URL(row.url).searchParams.has("syncToken")), "unrenewable channel recovers through full sync before availability");

  for (const [status, reason] of [[401, "unauthorized"], [429, "quota_exhausted"]]) {
    await d.wire("google-read-status", status);
    await d.raw("/api/app/calendar/check", {}, 503);
    assert.equal((await d.op("/api/app/calendar/connection")).reason, reason);
    await d.wire("google-read-status", 0);
    await d.op("/api/app/calendar/check", {});
  }
  await d.wire("google-invalid-cursor", 1);
  await d.until("the scheduled invalid-cursor failure", async () => (await d.op("/api/app/calendar/connection")).reason === "invalid_sync_cursor", 90_000);
  const invalid = await d.state();
  assert.equal(invalid.calendar_connections[0].sync_cursor, null);
  await d.slots(5);
  assert.ok(syncs(await d.state()).slice(syncs(invalid).length).some(row => !new URL(row.url).searchParams.has("syncToken")));
  pass("CAL-006 journey 6c: durable reauthorization/restoration facts with reasons; expired and unrenewable channels force full sync and fresh busy time, early renewal keeps the cursor; unauthorized, quota and invalid-cursor failures remain named");
}
