import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { contract } from "./contract.mjs";
import { receiptDatabase } from "./request-receipt/database.mjs";
const output = await build({ entryPoints: [new URL("./host-setup/core.ts", import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm" });
const core = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
const origin = "https://booking.example.test";
const profileInput = { name: "Host Test", handle: "host-test", title: "Host", biography: "Own workspace", timezone: "UTC", focusAreas: [], socialProof: [] };
async function fixture(t) {
  const f = await receiptDatabase(t);
  f.sqlite.exec("DELETE FROM event_types; DELETE FROM host_profiles;");
  const profiles = new core.HostProfileService(new core.HostProfileRepository(f.binding));
  const repository = new core.EventTypesRepository(f.binding);
  const health = { calendar: true, mail: true, meet: true };
  const publication = { calendar: { async checkConnection() { return health.calendar ? { kind: "healthy", conferenceCapable: health.meet } : { kind: "unavailable", code: "disconnected" }; } }, mail: { async checkConnection() { if (!health.mail) throw new Error("sender_unverified"); return { checkedAt: new Date().toISOString() }; } } };
  const events = new core.EventTypesService(repository, profiles, publication);
  const reports = new core.HostSetupRepository(f.binding);
  const setup = new core.HostSetupService(reports, profiles, events, origin);
  const create = () => events.createEventType({ ...core.defaultEventTypeInput(), title: "Introduction", slug: "intro", description: "Description", availability: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] });
  return { ...f, profiles, repository, events, reports, setup, health, create };
}

contract("BASE-OPS-002", "copy-report migration preserves prior records and invalidates reports inside event/profile writes", async t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const folder = new URL("../migrations/core/", import.meta.url);
  for (const name of (await readdir(folder)).sort().filter(name => name < "0025")) db.exec(await readFile(new URL(name, folder), "utf8"));
  db.exec("INSERT INTO host_profiles(id,singleton_key,handle,name,title,biography,timezone,created_at,updated_at) VALUES('prior','default','prior','Prior','Title','Bio','UTC','before','before')");
  const before = db.prepare("SELECT * FROM host_profiles").all();
  db.exec(await readFile(new URL("0025_host_link_copy_reports.sql", folder), "utf8"));
  assert.deepEqual(db.prepare("SELECT * FROM host_profiles").all(), before);
  assert.equal(db.prepare("SELECT count(*) AS n FROM host_link_copy_reports").get().n, 0);
});

contract("EVENT-006", "seven setup steps remain truthful for empty, request-only and fully configured installs", async t => {
  const f = await fixture(t), unchecked = { state: "disconnected", checkedAt: null, reason: "disconnected" }, healthy = { state: "healthy", checkedAt: new Date().toISOString(), reason: null };
  assert.deepEqual(core.setupSteps(await f.setup.read(), unchecked, unchecked).map(s => s.done), [false, false, true, false, false, false, false]);
  await f.profiles.saveProfile(profileInput);
  const event = await f.create();
  await f.repository.replaceRecurringAvailability(event.id, []); f.health.calendar = false;
  assert.equal((await f.events.openRequests(event.id)).kind, "published");
  const state = await f.setup.read();
  assert.equal(state.links[0].url, origin + "/book/host-test/intro");
  assert.equal(state.links[0].requestOnly, true);
  assert.equal((await f.setup.reportCopy(event.id, state.links[0].url)).kind, "recorded");
  assert.deepEqual(core.setupSteps(await f.setup.read(), unchecked, healthy).map(s => s.done), [true, true, true, false, true, true, true]);
  await f.repository.replaceRecurringAvailability(event.id, [{ weekday: 1, startMinute: 540, endMinute: 1020 }]); f.health.calendar = true;
  assert.equal((await f.events.publishEventType(event.id)).kind, "published");
  await f.setup.reportCopy(event.id, state.links[0].url);
  assert.ok(core.setupSteps(await f.setup.read(), healthy, healthy).every(s => s.done));
  const stale = { ...healthy, checkedAt: "2000-01-01T00:00:00Z" };
  assert.equal(core.setupSteps(await f.setup.read(), stale, { ...healthy, checkedAt: null })[1].done, false);
  assert.equal(core.setupSteps(await f.setup.read(), stale, healthy)[2].done, false);
});

contract("AUTH-001", "copy reports bind current event/profile/origin and persist server times across fresh services", async t => {
  const f = await fixture(t); await f.profiles.saveProfile(profileInput); const event = await f.create();
  const url = origin + "/book/host-test/intro";
  assert.equal((await f.setup.reportCopy(event.id, url)).kind, "link_not_eligible");
  await f.events.publishEventType(event.id);
  const before = Date.now(), report = await f.setup.reportCopy(event.id, url);
  assert.equal(report.kind, "recorded"); assert.ok(Date.parse(report.report.acceptedAt) >= before); assert.ok(Date.parse(report.report.acceptedAt) <= Date.now());
  const fresh = new core.HostSetupService(new core.HostSetupRepository(f.binding), f.profiles, f.events, origin);
  assert.equal((await fresh.read()).links[0].copiedAt, report.report.acceptedAt);
  const snapshot = f.snapshot(); assert.equal((await f.setup.reportCopy(event.id, "https://wrong.example.test/book/host-test/intro")).kind, "booking_link_changed"); assert.equal(f.snapshot(), snapshot);
  const otherOrigin = new core.HostSetupService(f.reports, f.profiles, f.events, "https://moved.example.test");
  const originSnapshot = f.snapshot();
  assert.equal((await otherOrigin.read()).links[0].copiedAt, null); assert.equal(f.snapshot(), originSnapshot, "origin revalidation never mutates retained reports");
  await f.repository.setStatus(event.id, "disabled"); assert.equal((await f.setup.read()).links.length, 0);
  await f.events.publishEventType(event.id); assert.equal((await f.setup.read()).links[0].copiedAt, null);
  await f.setup.reportCopy(event.id, url);
  await f.profiles.saveProfile({ ...profileInput, handle: "renamed" }); assert.equal((await f.setup.read()).links[0].copiedAt, null);
  await f.profiles.saveProfile(profileInput); assert.equal((await f.setup.read()).links[0].copiedAt, null);
  await f.setup.reportCopy(event.id, url);
  await f.repository.update(event.id, { ...await f.events.getEventType(event.id), slug: "new-slug" }); assert.equal((await f.setup.read()).links[0].copiedAt, null);
  assert.equal((await f.setup.reportCopy("missing", url)).kind, "event_not_found");
  const current = await f.events.getEventType(event.id), profile = await f.profiles.getProfile();
  await f.repository.setStatus(event.id, "disabled"); assert.equal(await f.reports.record(current, profile, url), null, "write rechecks event snapshot after awaited reads");
});

for (const code of Object.keys(core.readinessFixes)) contract("EVENT-006", `${code} publication requirement names a concrete resolving screen`, async t => {
  const f = await fixture(t); let event = await f.create();
  if (code !== "host_profile") await f.profiles.saveProfile(profileInput);
  if (code === "private_location") { await f.repository.update(event.id, { ...event, locationType: "in_person", locationValue: "" }); event = await f.events.getEventType(event.id); }
  if (code === "open_availability") { await f.repository.replaceRecurringAvailability(event.id, []); event = await f.events.getEventType(event.id); }
  if (code === "transactional_mail") f.health.mail = false;
  if (code === "destination_calendar") f.health.calendar = false;
  if (code === "google_meet_capability") f.health.meet = false;
  if (code === "alternative_requests_enabled") { await f.events.setAlternativeRequests(event.id, false); event = await f.events.getEventType(event.id); }
  let actual;
  if (code === "event_not_found") actual = (await f.events.publishEventType("missing")).kind;
  else if (code === "event_already_published") { await f.events.publishEventType(event.id); actual = (await f.events.requestReadiness(await f.events.getEventType(event.id))).missing[0]; }
  else if (code === "event_configuration_changed") {
    const original = f.repository.publishChecked.bind(f.repository);
    f.repository.publishChecked = async (candidate, profile) => { await f.repository.update(candidate.id, { ...candidate, title: "Changed concurrently" }); return original(candidate, profile); };
    actual = (await f.events.publishEventType(event.id)).readiness.missing.at(-1);
  } else actual = (await (code === "alternative_requests_enabled" ? f.events.requestReadiness(event) : f.events.publishReadiness(event))).missing[0];
  assert.equal(actual, code);
  const fix = core.readinessFix(code, event.id); assert.match(fix.href, /^\/app\//); assert.ok(fix.label.length > 10);
  if (code === "open_availability") assert.equal(fix.href, `/app/event-types/${event.id}/availability`);
  if (code === "host_profile") assert.equal(fix.href, "/app/profile");
  if (code === "private_location") assert.equal(fix.href, `/app/event-types/${event.id}`);
});

contract("BASE-OPS-001", "platform status reports actual D1 R2 and Queue outcomes, including failure", async () => {
  const calls = [];
  const bindings = { database: { prepare(sql) { calls.push(sql); return { run: async () => ({}) }; } }, files: { head: async key => { calls.push(key); return null; } }, jobs: { send: async value => calls.push(value.kind) } };
  assert.deepEqual((await core.checkPlatformBindings(bindings)).checks, { database: "ok", storage: "ok", queue: "ok" });
  assert.equal(calls.length, 3);
  for (const name of ["database", "storage", "queue"]) {
    const failing = { ...bindings };
    if (name === "database") failing.database = { prepare: () => ({ run: async () => { throw new Error("offline"); } }) };
    if (name === "storage") failing.files = { head: async () => { throw new Error("offline"); } };
    if (name === "queue") failing.jobs = { send: async () => { throw new Error("offline"); } };
    const result = await core.checkPlatformBindings(failing); assert.equal(result.checks[name], "unavailable"); assert.equal(result.status, "unavailable");
  }
});

contract("BASE-OPS-001", "one pending platform primitive marks only itself unavailable and the others keep their own result", async () => {
  const ok = { database: { prepare: () => ({ run: async () => ({}) }) }, files: { head: async () => null }, jobs: { send: async () => undefined } };
  for (const name of ["database", "storage", "queue"]) {
    const pending = { ...ok };
    if (name === "database") pending.database = { prepare: () => ({ run: () => new Promise(() => {}) }) };
    if (name === "storage") pending.files = { head: () => new Promise(() => {}) };
    if (name === "queue") pending.jobs = { send: () => new Promise(() => {}) };
    const started = Date.now();
    const result = await core.checkPlatformBindings(pending, { databaseAndStorageMs: 40, queueMs: 40 });
    assert.ok(Date.now() - started < 1_000, "a pending provider call cannot hold the response");
    assert.deepEqual(result.checks, Object.fromEntries(["database", "storage", "queue"].map(key => [key, key === name ? "unavailable" : "ok"])));
    assert.equal(result.status, "unavailable");
  }
});

contract("PUBLIC-004", "inline and modal embed tags preserve the exact native protocol and public origin", () => {
  const script = '<script async src="https://booking.example.test/embed/dial.js" data-dial-handle="host-test" data-dial-embed="intro" data-dial-mode="inline"></script>';
  assert.equal(core.embedSnippet(origin, "host-test", "intro", "inline"), script);
  assert.equal(core.embedSnippet(origin, "host-test", "intro", "modal"), '<button type="button" data-dial-embed="intro">Book a time</button>\n' + script.replace('"inline"', '"modal"'));
  assert.match(core.operatorTimestamp("2026-01-02T12:30:00Z"), /Jan 2, 2026.*12:30 PM.*UTC/);
});

contract("BASE-SECRET-001", "sharing accepts only the validated public install origin", () => {
  assert.equal(core.installPublicOrigin("https://booking.example.test/"), origin);
  assert.equal(core.installPublicOrigin("http://127.0.0.1:15762/"), "http://127.0.0.1:15762");
  for (const value of ["https://name:password@booking.example.test", "https://booking.example.test/path", "https://booking.example.test/?token=private", "https://booking.example.test/#private", "javascript:alert(1)", "http://public.example.test"]) assert.throws(() => core.installPublicOrigin(value), /APP_URL/);
});

contract("EVENT-006", "publication and copy reject an invalid or concurrently changed host and disabled request eligibility", async t => {
  const f = await fixture(t); await f.profiles.saveProfile(profileInput); const event = await f.create();
  for (const changed of [{ name: " " }, { handle: "Invalid handle" }, { timezone: "not-a-zone" }]) {
    await f.profiles.saveProfile({ ...profileInput, ...changed });
    assert.ok((await f.events.publishReadiness(event)).missing.includes("host_profile"));
    assert.ok((await f.events.requestReadiness(event)).missing.includes("host_profile"));
    assert.equal((await f.setup.read()).profileReady, false);
  }
  await f.profiles.saveProfile(profileInput); await f.events.openRequests(event.id);
  const current = await f.events.getEventType(event.id), profile = await f.profiles.getProfile(), url = origin + "/book/host-test/intro";
  await f.profiles.saveProfile({ ...profileInput, handle: "changed" });
  assert.equal(await f.reports.record(current, profile, url), null, "copy write rechecks host identity");
  await f.profiles.saveProfile(profileInput); await f.events.setAlternativeRequests(event.id, false);
  assert.equal((await f.setup.reportCopy(event.id, url)).kind, "link_not_eligible");
  assert.equal((await f.setup.read()).links.length, 0);
});

contract("EVENT-006", "configuration changes fence checked publication and copying even when the clock stalls or moves backwards", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2030-01-01T23:59:59.999Z") });
  const override = { hostDate: "2030-01-02", mode: "open", windows: [{ startMinute: 600, endMinute: 660 }] };
  const edits = {
    full: (f, event) => f.repository.update(event.id, { ...event, title: "Latest title" }),
    details: (f, event) => f.repository.updateDetails(event.id, { ...event, title: "Latest details", questions: [{ kind: "text", label: "Latest question", required: true, options: [] }] }),
    weekly: (f, event) => f.repository.replaceRecurringAvailability(event.id, [{ weekday: 2, startMinute: 600, endMinute: 660 }]),
    requests: (f, event) => f.repository.setAlternativeRequests(event.id, true),
    status: (f, event) => f.repository.setStatus(event.id, event.status),
    overrideInsert: (f, event) => f.repository.replaceDateAvailabilityOverride(event.id, override),
    overrideUpdate: (f, event) => f.repository.replaceDateAvailabilityOverride(event.id, { ...override, mode: "closed", windows: [] }),
    overrideDelete: (f, event) => f.repository.deleteDateAvailabilityOverride(event.id, override.hostDate),
  };
  for (const backwards of [false, true]) for (const action of ["publish", "requests", "copy"]) for (const [name, edit] of Object.entries(edits)) {
    t.mock.timers.setTime(Date.parse("2030-01-01T23:59:59.999Z"));
    const f = await fixture(t); await f.profiles.saveProfile(profileInput); const event = await f.create();
    if (name === "overrideUpdate" || name === "overrideDelete") await f.repository.replaceDateAvailabilityOverride(event.id, override);
    if (action === "copy") assert.equal((await f.events.publishEventType(event.id)).kind, "published");
    if (backwards) t.mock.timers.setTime(Date.parse("2029-01-01T00:00:00.000Z"));
    const target = action === "copy" ? f.reports : f.repository;
    const method = { publish: "publishChecked", requests: "openRequestsChecked", copy: "record" }[action];
    const original = target[method].bind(target);
    let latest;
    target[method] = async (candidate, ...args) => {
      const returned = await edit(f, candidate), stored = await f.repository.get(candidate.id);
      assert.ok(Date.parse(stored.updatedAt) > Date.parse(candidate.updatedAt), `${action}/${name}: persisted revision advances`);
      assert.equal(new Date(stored.updatedAt).toISOString(), stored.updatedAt, "revision remains canonical ISO across midnight");
      if (returned?.updatedAt && !name.startsWith("override")) assert.equal(returned.updatedAt, stored.updatedAt, "returned event uses the stored revision");
      latest = f.snapshot();
      return original(candidate, ...args);
    };
    const result = action === "copy" ? await f.setup.reportCopy(event.id, origin + "/book/host-test/intro")
      : await f.events[action === "publish" ? "publishEventType" : "openRequests"](event.id);
    assert.equal(result.kind, action === "copy" ? "booking_link_changed" : "not_ready", `${action}/${name}/${backwards}`);
    if (action !== "copy") assert.ok(result.readiness.missing.includes("event_configuration_changed"));
    assert.equal(f.snapshot(), latest, "rejected stale action preserves every committed record");
  }

  const f = await fixture(t); await f.profiles.saveProfile(profileInput); const event = await f.create();
  // Independent editor saves must preserve one another's fields despite stale inputs.
  const weekly = await f.repository.replaceRecurringAvailability(event.id, [{ weekday: 3, startMinute: 700, endMinute: 800 }]);
  await f.repository.setAlternativeRequests(event.id, false);
  const details = await f.repository.updateDetails(event.id, { ...event, title: "Independent details" });
  assert.deepEqual(details.availability, weekly.availability); assert.equal(details.alternativeRequestsEnabled, false);
  assert.equal((await f.repository.replaceRecurringAvailability(event.id, event.availability)).title, details.title);
  for (const write of [
    () => f.repository.update(event.id, { ...event, availability: [{ weekday: 1, startMinute: 700, endMinute: 600 }] }),
    () => f.repository.updateDetails(event.id, { ...event, questions: [{ kind: "invalid", label: "Question", required: true, options: [] }] }),
    () => f.repository.replaceRecurringAvailability(event.id, [{ weekday: 1, startMinute: 700, endMinute: 600 }]),
    () => f.repository.replaceDateAvailabilityOverride(event.id, { ...override, windows: [{ startMinute: 700, endMinute: 600 }] }),
  ]) {
    const before = f.snapshot(); await assert.rejects(write); assert.equal(f.snapshot(), before, "failed child write rolls back the revision and all configuration");
  }
  await f.repository.replaceDateAvailabilityOverride(event.id, override);
  const before = f.snapshot();
  await assert.rejects(() => f.repository.replaceDateAvailabilityOverride(event.id, { ...override, windows: [{ startMinute: 700, endMinute: 600 }] }));
  assert.equal(f.snapshot(), before, "failed override replacement preserves prior windows and parent revision");
  f.sqlite.exec("CREATE TRIGGER fail_override_delete BEFORE DELETE ON availability_date_overrides BEGIN SELECT RAISE(ABORT, 'delete blocked'); END");
  await assert.rejects(() => f.repository.deleteDateAvailabilityOverride(event.id, override.hostDate), /delete blocked/);
  assert.equal(f.snapshot(), before, "failed override delete rolls back the parent revision");
  f.sqlite.exec("DROP TRIGGER fail_override_delete");
  assert.equal(await f.repository.deleteDateAvailabilityOverride(event.id, "2030-01-03"), false);
  assert.equal(f.snapshot(), before, "missing override deletion does not touch the parent");
  assert.equal(await f.repository.deleteDateAvailabilityOverride(event.id, override.hostDate), true);
  const current = await f.repository.get(event.id);
  const published = await f.events.publishEventType(event.id);
  assert.equal(published.kind, "published"); assert.ok(Date.parse(published.eventType.updatedAt) > Date.parse(current.updatedAt));
  assert.deepEqual(published.eventType, await f.repository.get(event.id));
  await f.repository.setStatus(event.id, "disabled"); await f.repository.setAlternativeRequests(event.id, true);
  const opened = await f.events.openRequests(event.id);
  assert.equal(opened.kind, "published"); assert.deepEqual(opened.eventType, await f.repository.get(event.id));
  assert.equal((await f.setup.reportCopy(event.id, origin + "/book/host-test/intro")).kind, "recorded");
});

contract("OPER-005", "finish refuses stale profile event copy or failing current mail and fences awaited writes", async t => {
  const f = await fixture(t);
  f.sqlite.exec("INSERT INTO operator_setup_identity(singleton_key,operator_id,created_at) VALUES('default','fixture-owner','2026-01-01') ON CONFLICT DO NOTHING");
  await f.profiles.saveProfile(profileInput); const event = await f.create();
  await f.repository.replaceRecurringAvailability(event.id, []); f.health.calendar = false;
  await f.events.openRequests(event.id);
  const url = origin + "/book/host-test/intro";
  await f.setup.reportCopy(event.id, url);
  f.health.mail = false; assert.deepEqual((await f.setup.complete()).missing, ["transactional_mail"]);
  f.health.mail = true;
  await f.profiles.saveProfile({ ...profileInput, name: " " }); assert.deepEqual((await f.setup.complete()).missing, ["host_profile"]);
  await f.profiles.saveProfile(profileInput); assert.equal((await f.setup.complete()).kind, "not_ready");
  await f.setup.reportCopy(event.id, url);
  const moved = new core.HostSetupService(f.reports, f.profiles, f.events, "https://moved.example.test");
  assert.equal((await moved.complete()).kind, "not_ready");
  const original = f.reports.complete.bind(f.reports);
  f.reports.complete = async (...args) => { await f.repository.updateDetails(event.id, { ...await f.events.getEventType(event.id), title: "Changed while checking" }); return original(...args); };
  assert.equal((await f.setup.complete()).kind, "not_ready"); assert.equal(await f.setup.completion(), null);
  f.reports.complete = original; await f.setup.reportCopy(event.id, url);
  assert.equal((await f.setup.complete()).kind, "completed");
});

contract("OPER-005", "forward upgrade preserves existing identity bytes and access; later claims remain unfinished", async t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const folder = new URL("../migrations/core/", import.meta.url);
  for (const name of (await readdir(folder)).sort().filter(name => name < "0027")) db.exec(await readFile(new URL(name, folder), "utf8"));
  db.exec("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('prior','prior@example.test','Prior','owner','active',1); INSERT INTO operator_setup_identity(singleton_key,operator_id,created_at) VALUES('default','prior','2026-01-02T03:04:05.000Z')");
  const before = db.prepare("SELECT * FROM operator_setup_identity").get();
  db.exec(await readFile(new URL("0027_first_run_setup.sql", folder), "utf8"));
  const after = db.prepare("SELECT * FROM operator_setup_identity").get();
  assert.deepEqual({ ...after }, { ...before, onboarding_completed_at: before.created_at });
  db.exec("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('second','second@example.test','Second','owner','active',1); UPDATE oa_operators SET status='inactive' WHERE id='prior'; UPDATE oa_operators SET status='active' WHERE id='prior'");
  assert.equal(db.prepare("SELECT onboarding_completed_at FROM operator_setup_identity").get().onboarding_completed_at, before.created_at);
  db.exec("DELETE FROM operator_setup_identity; INSERT INTO operator_setup_identity(singleton_key,operator_id,created_at) VALUES('default','second','2026-02-01')");
  assert.equal(db.prepare("SELECT onboarding_completed_at FROM operator_setup_identity").get().onboarding_completed_at, null);
});
