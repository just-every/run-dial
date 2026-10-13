import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { lstat, mkdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark } from "./benchmark.mjs";
import { seedLocalBookings, verifyPersistedSearch } from "./seed.mjs";
import { applyBookingSearchMigration, compileCapacityWorker, startCapacityRuntime } from "./runtime.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export async function runIsolatedCapacityBenchmark(runs = 20) {
  const wranglerRoot = join(root, ".wrangler");
  await mkdir(wranglerRoot, { recursive: true });
  const wranglerInfo = await lstat(wranglerRoot);
  if (!wranglerInfo.isDirectory() || wranglerInfo.isSymbolicLink()) throw new Error("The checkout's .wrangler path must be a real directory.");

  const persistDirectory = join(wranglerRoot, `dial-capacity-${process.pid}-${Date.now()}`);
  await mkdir(persistDirectory);
  let runtime;
  let seededRuntime;
  try {
    const workerModule = await compileCapacityWorker();
    runtime = await startCapacityRuntime({ persistDirectory, workerModule, deferSearchMigration: true });
    const sessionCookie = runtime.cookie;
    await runtime.close();
    runtime = undefined;

    const seed = await seedLocalBookings(undefined, persistDirectory);
    seededRuntime = await startCapacityRuntime({ persistDirectory, workerModule, cookie: sessionCookie });
    const upgradeStartedAt = performance.now();
    await applyBookingSearchMigration(seededRuntime.db);
    const populatedSearchUpgradeMs = performance.now() - upgradeStartedAt;
    await seededRuntime.close(); seededRuntime = undefined;
    const normalizedBookings = await verifyPersistedSearch(persistDirectory);
    assert.equal(normalizedBookings, 100_000, "all prior rows are normalized before timed HTTP search");
    seededRuntime = await startCapacityRuntime({ persistDirectory, workerModule, cookie: sessionCookie });
    const bookingCount = await countRows(seededRuntime.db, "SELECT count(*) AS total FROM bookings");
    const failedDeliveryCount = await countRows(seededRuntime.db, "SELECT count(*) AS total FROM delivery_outbox WHERE state = 'failed' AND last_error_code = 'benchmark_failure'");
    const eventType = await seededRuntime.db.prepare("SELECT id FROM event_types WHERE request_only = 0 ORDER BY id LIMIT 1").first();
    const combinedFilterExpectedCount = await countRows(seededRuntime.db, `SELECT count(*) AS total FROM bookings b
      JOIN booking_occurrences o ON b.current_occurrence_id = o.id
      WHERE b.state = 'confirmed' AND b.event_type_id = ? AND o.start_at >= ? AND o.start_at >= ? AND o.start_at <= ?
        AND EXISTS (SELECT 1 FROM delivery_outbox d WHERE d.booking_id = b.id AND d.state = 'failed')
        AND instr(lower(b.invitee_name), lower(?)) > 0`, [eventType.id, new Date().toISOString(), "2035-01-01T00:00:00.000Z", "2035-01-31T23:59:59.999Z", "capacity guest"]);
    const unicodeInviteeCount = await countRows(seededRuntime.db, "SELECT count(*) AS total FROM bookings WHERE invitee_name = ?", ["Élodie Capacity Guest 099998"]);
    assert.equal(bookingCount, 100_000, "the reopened local D1 contains exactly 100,000 bookings");
    assert.equal(failedDeliveryCount, seed.failedDeliveries, "the reopened local D1 retains every seeded failed-delivery row");
    assert.equal(combinedFilterExpectedCount, 1_667, "the independently counted combined-filter fixture has known matches");
    assert.equal(unicodeInviteeCount, 1, "the local capacity fixture contains one Unicode invitee");

    const measurement = await runBenchmark({ origin: seededRuntime.origin, runs, sessionCookie });
    return {
      persistenceDirectory: relative(root, persistDirectory),
      seed: { bookings: seed.bookings, eventTypesUsed: seed.eventTypesUsed, failedDeliveries: seed.failedDeliveries },
      reopenedD1: { bookings: bookingCount, failedDeliveries: failedDeliveryCount },
      populatedSearchUpgrade: { migration: "0033_booking_search.sql", elapsedMs: populatedSearchUpgradeMs, normalizedBookings, beforeTimedSearch: true },
      knownData: { combinedFilterExpectedBookings: combinedFilterExpectedCount, unicodeInvitees: unicodeInviteeCount },
      ...measurement,
    };
  } finally {
    await seededRuntime?.close();
    await runtime?.close();
    await rm(persistDirectory, { recursive: true, force: true });
  }
}

async function countRows(db, sql, values = []) {
  const statement = db.prepare(sql);
  const row = await (values.length > 0 ? statement.bind(...values) : statement).first();
  return Number(row?.total ?? -1);
}
