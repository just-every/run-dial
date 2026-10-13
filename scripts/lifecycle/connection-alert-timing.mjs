import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { evidencePath, externalEvidencePath } from "../evidence-path.mjs";
import { startLifecycleRuntime } from "./runtime.mjs";
import { lifecycleDoors } from "./doors.mjs";

// NOTIFY-007 timed from the failure's onset, on the lifecycle runtime (scripts/lifecycle/runtime.mjs). Each run starts a
// calendar failure that no request sees at a chosen second of the scheduler's minute and times the alert reaching the
// mail provider; per failure kind, the phase with the slowest alert is run again until it has `worstRuns` timings. The
// kinds: every calendar read fails; only free/busy over the conflict calendar fails (unshared or deleted); and every
// read fails in the first minute after the calendar is connected. Brief errors must send nothing: one no request sees,
// and two that each clear within the window, the second spanning the first's original confirmation. It also counts
// Google calls per minute on an idle healthy connection.
//   node scripts/lifecycle/connection-alert-timing.mjs [worstRuns=5]
// writes connection-alert-timing.json to the evidence directory, or to DIAL_EVIDENCE_FILE.
const phases = [
  { name: "just after a pass", second: 2 },
  { name: "mid-interval", second: 15 },
  { name: "just after the half minute", second: 32 },
  { name: "just before a pass", second: 57 },
];
const reads = /\/users\/me\/calendarList|\/freeBusy$/;
const kinds = [
  { name: "calendar reads fail", knob: "google-read-status", value: 503, seenBy: reads },
  { name: "conflict calendar only", knob: "google-busy-error", value: 1, seenBy: /\/freeBusy$/ },
  { name: "first minute after connect", knob: "google-read-status", value: 503, seenBy: reads, afterConnect: true },
];
// The second error starts 18 s after the first and lasts 6 s, across the first one's confirmation as it was scheduled.
const twoBriefCases = [{ first: 10, from: 28, to: 34 }, { first: 35, from: 53, to: 59 }];
const worstRuns = Number(process.argv[2] ?? 5);
const runtime = await startLifecycleRuntime();
const runs = [], briefs = [];
let callsPerMinute, failure;
try {
  const d = lifecycleDoors(runtime);
  const { op, raw, state, until, nextPass, mailTo, wire, sleep } = d;
  const alerts = async () => mailTo(await state(), "operator@dial.test", /^Calendar connection needs attention$/);
  const recoveries = async () => mailTo(await state(), "operator@dial.test", /^Calendar connection recovered$/).length;
  const firstRead = async (after, seenBy = reads) => (await state()).wire_calls.find(row => seenBy.test(new URL(row.url).pathname) && Date.parse(row.at) >= after);
  const healthy = async () => assert.equal((await op("/api/app/calendar/connection")).state, "healthy");
  // Every phase is measured from a minute the scheduler has started, so "just after a pass" follows a completed pass.
  const atPhase = async second => { await nextPass(); await d.atSecond(second); };
  const second = at => Number((new Date(at).getUTCSeconds() + (at % 1000) / 1000).toFixed(1));

  await d.signIn();
  await d.connectCalendar();
  await healthy();

  // Google calls per minute on an idle healthy connection, over whole scheduler minutes.
  {
    await nextPass();
    const start = Date.now() - (Date.now() % 60_000), minutes = 5;
    await sleep(start + minutes * 60_000 + 1_500 - Date.now());
    const kind = row => { const url = new URL(row.url); if (url.hostname === "oauth2.googleapis.com") return "token"; if (/\/users\/me\/calendarList\/.+/.test(url.pathname)) return "destination"; if (url.pathname.endsWith("/calendarList")) return "calendarList"; if (url.pathname.endsWith("/freeBusy")) return "freeBusy"; return url.pathname.includes("/events") ? "events" : "other"; };
    const google = (await state()).wire_calls.filter(row => /googleapis\.com$/.test(new URL(row.url).hostname) && Date.parse(row.at) >= start && Date.parse(row.at) < start + minutes * 60_000);
    const counts = {};
    for (const row of google) counts[kind(row)] = (counts[kind(row)] ?? 0) + 1;
    callsPerMinute = { minutes, total: google.length / minutes, ...Object.fromEntries(Object.entries(counts).map(([name, count]) => [name, count / minutes])) };
    console.log(`CALLS per minute ${JSON.stringify(callsPerMinute)}`);
  }

  async function timed(kind, phase) {
    const sent = (await alerts()).length, recovered = await recoveries();
    if (kind.afterConnect) {
      // Disconnected long enough that the watch has stopped, as after a fresh install or a reconnect much later.
      await raw("/api/app/calendar/connection", undefined, 204, "DELETE");
      await sleep(40_000);
    }
    await atPhase(phase.second);
    if (kind.afterConnect) await d.connectCalendar();
    await healthy();
    const onset = Date.now();
    await wire(kind.knob, kind.value);
    const alert = await until(`the alert for ${kind.name} ${phase.name}`, async () => (await alerts())[sent], 150_000);
    const seen = await firstRead(onset, kind.seenBy);
    await wire(kind.knob, 0);
    await until("the recovery announcement", async () => await recoveries() === recovered + 1, 150_000);
    const run = { kind: kind.name, phase: phase.name, onsetSecond: second(onset), onset: new Date(onset).toISOString(), firstSeenAfterMs: Date.parse(seen.at) - onset, alertAfterMs: Date.parse(alert.at) - onset };
    runs.push(run);
    console.log(`TIMED ${run.kind}, ${run.phase} (:${run.onsetSecond}) seen ${(run.firstSeenAfterMs / 1000).toFixed(1)} s, alerted ${(run.alertAfterMs / 1000).toFixed(1)} s after onset`);
    return run;
  }

  for (const kind of kinds) {
    const scan = [];
    for (const phase of phases) scan.push(await timed(kind, phase));
    const worst = phases.find(phase => phase.name === scan.reduce((slowest, run) => run.alertAfterMs > slowest.alertAfterMs ? run : slowest).phase);
    for (let count = 1; count < worstRuns; count++) await timed(kind, worst);
  }

  const settledCounts = async (sent, recovered) => {
    await sleep(40_000); await nextPass(); await sleep(5_000); await nextPass(); await sleep(3_000);
    return { alerts: (await alerts()).length - sent, recoveries: await recoveries() - recovered };
  };

  // A brief error no request sees: it clears 5 s after the first failing provider call, before that sighting's confirmation.
  {
    const sent = (await alerts()).length, recovered = await recoveries();
    await atPhase(2);
    const onset = Date.now();
    await wire("google-read-status", 503);
    const seen = await until("the first failing provider call", () => firstRead(onset), 90_000);
    await sleep(5_000);
    await wire("google-read-status", 0);
    const clearedAfterMs = Date.now() - onset;
    const brief = { case: "brief error no request sees", onset: new Date(onset).toISOString(), firstSeenAfterMs: Date.parse(seen.at) - onset, clearedAfterMs, ...await settledCounts(sent, recovered) };
    briefs.push(brief);
    console.log(`BRIEF seen ${(brief.firstSeenAfterMs / 1000).toFixed(1)} s, cleared ${(clearedAfterMs / 1000).toFixed(1)} s after onset: ${brief.alerts} alerts, ${brief.recoveries} recoveries`);
  }

  // Two brief errors: a request sees a 2 s error, and a second 6 s error starts 18 s later, across the first one's
  // original confirmation. The connection reads healthy between them, so neither persists through its own window.
  for (const { first, from, to } of twoBriefCases) {
    await healthy();
    const sent = (await alerts()).length, recovered = await recoveries();
    await atPhase(first);
    await wire("google-read-status", 503);
    const firstAt = Date.now();
    await raw("/api/app/calendar/calendars", undefined, 503);
    await sleep(2_000);
    await wire("google-read-status", 0);
    const firstClearedAt = Date.now();
    await d.atSecond(from);
    const secondAt = Date.now();
    await wire("google-read-status", 503);
    await d.atSecond(to);
    await wire("google-read-status", 0);
    const secondClearedAt = Date.now();
    const brief = { case: "two brief errors", firstSecond: second(firstAt), firstDurationMs: firstClearedAt - firstAt, secondOnsetAfterFirstMs: secondAt - firstAt, secondDurationMs: secondClearedAt - secondAt, ...await settledCounts(sent, recovered) };
    briefs.push(brief);
    console.log(`BRIEF two errors at :${brief.firstSecond} (${brief.firstDurationMs} ms) and ${(brief.secondOnsetAfterFirstMs / 1000).toFixed(1)} s later (${brief.secondDurationMs} ms): ${brief.alerts} alerts, ${brief.recoveries} recoveries`);
  }
  await healthy();

  for (const brief of briefs) assert.deepEqual([brief.alerts, brief.recoveries], [0, 0], `${brief.case} sends nothing`);
  assert.equal((await alerts()).length, runs.length, "one alert per incident");
  assert.equal(await recoveries(), runs.length, "one recovery per incident");
  const late = runs.filter(run => run.alertAfterMs >= 60_000);
  assert.equal(late.length, 0, `alerts at or over 60 s from onset: ${late.map(run => `${run.kind}, ${run.phase} ${run.alertAfterMs}ms`).join("; ")}`);
} catch (error) { failure = error; }
const output = runtime.output();
await runtime.stop();
const result = { verifiedAt: new Date().toISOString(), ok: !failure, worstRuns, callsPerMinute, runs, briefs, scheduledPasses: runtime.passes.length, ...(failure ? { failure: String(failure.stack ?? failure), workerOutput: output.slice(-6000) } : {}) };
await writeFile(process.env.DIAL_EVIDENCE_FILE ? externalEvidencePath(process.env.DIAL_EVIDENCE_FILE) : evidencePath("connection-alert-timing.json"), JSON.stringify(result, null, 2) + "\n");
if (failure) { console.error(output.slice(-6000)); throw failure; }
console.log(`Connection alert timing passed: ${runs.length} timed runs, slowest ${Math.max(...runs.map(run => run.alertAfterMs))}ms from onset.`);
