import { foldBookingSearch } from "../../src/core/features/bookings/search/case-fold.mjs";
import { lstat, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { ulid } from "ulid";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const defaultD1Directory = join(root, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
const bookingCount = 100_000;

export async function seedLocalBookings(requestedPath, persistDirectory) {
  const databasePath = await findDatabase(requestedPath, d1Directory(persistDirectory));
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const total = database.prepare("SELECT count(*) AS count FROM bookings").get().count;
    if (total !== 0) throw new Error(`The selected local D1 already contains ${total} bookings. Back up or reset that local install before seeding.`);
    const events = database.prepare(`SELECT id, slug, title, duration_minutes AS durationMinutes, location_type AS locationType,
      location_label AS locationLabel, location_value AS locationValue FROM event_types WHERE request_only = 0 ORDER BY id LIMIT 100`).all();
    if (events.length === 0) throw new Error("Create at least one non-request-only event type in the local install before seeding bookings.");

    const insertBooking = database.prepare(`INSERT INTO bookings (
      id, event_type_id, event_slug, event_title, duration_minutes, location_type, location_label, location_value,
      invitee_name, invitee_email, host_timezone, invitee_timezone, state, ical_uid, calendar_state, meeting_state,
      current_occurrence_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UTC', 'UTC', ?, ?, 'succeeded', 'not_required', ?, ?, ?)`);
    const insertOccurrence = database.prepare(`INSERT INTO booking_occurrences (
      id, booking_id, sequence, start_at, end_at, occupied_start_at, occupied_end_at, host_date, state, is_current, created_at
    ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, 1, ?)`);
    const insertFailure = database.prepare(`INSERT INTO delivery_outbox (
      id, kind, idempotency_key, booking_id, occurrence_id, payload_json, state, attempts,
      next_attempt_at, last_error_code, created_at, updated_at
    ) VALUES (?, 'mail_send', ?, ?, ?, ?, 'failed', 1, ?, 'benchmark_failure', ?, ?)`);

    let failures = 0;
    database.exec("BEGIN IMMEDIATE");
    try {
      for (let index = 0; index < bookingCount; index += 1) {
        const id = ulid(), occurrenceId = ulid(), event = events[index % events.length];
        const startAt = bookingStart(index), endAt = new Date(Date.parse(startAt) + event.durationMinutes * 60_000).toISOString();
        const state = index % 3 === 0 ? "confirmed" : index % 3 === 1 ? "rescheduled" : "cancelled";
        const now = new Date().toISOString();
        const name = index === bookingCount - 3 ? "Capacity Guest Straße ẞ Σςσ ﬃ" : index === bookingCount - 4 ? `Capacity Guest ${"ẞ".repeat(145)}` : index === bookingCount - 2 ? `Élodie Capacity Guest ${String(index).padStart(6, "0")}` : `Capacity Guest ${String(index).padStart(6, "0")}`;
        const email = `guest-${String(index).padStart(6, "0")}@capacity.example.test`;
        insertBooking.run(id, event.id, event.slug, event.title, event.durationMinutes, event.locationType, event.locationLabel, event.locationValue, name, email, state, `${id}@dial-capacity.invalid`, occurrenceId, now, now);
        insertOccurrence.run(occurrenceId, id, startAt, endAt, startAt, endAt, startAt.slice(0, 10), state === "cancelled" ? "cancelled" : "current", now);
        if (index % 10 === 0) {
          const payload = JSON.stringify({ to: email, recipientRole: "invitee", subject: "Local capacity benchmark delivery", text: "Synthetic local capacity data." });
          insertFailure.run(ulid(), `capacity-benchmark:${id}`, id, occurrenceId, payload, now, now, now);
          failures += 1;
        }
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    const seeded = database.prepare("SELECT count(*) AS count FROM bookings").get().count;
    if (seeded !== bookingCount) throw new Error(`Local D1 reports ${seeded} seeded bookings; expected ${bookingCount}.`);
    return { bookings: seeded, eventTypesUsed: events.length, failedDeliveries: failures, next: "Restart the local app, then run the bench command with its loopback origin and DIAL_SESSION_COOKIE set." };
  } finally {
    database.close();
  }
}

async function findDatabase(requestedPath, localD1Directory) {
  await assertDirectoryTree(localD1Directory);
  const entries = await readdir(localD1Directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite")).map((entry) => join(localD1Directory, entry.name));
  const selectedPath = requestedPath
    ? requestedPath.includes(sep) ? resolve(root, requestedPath) : join(localD1Directory, requestedPath)
    : undefined;
  const candidates = selectedPath ? [selectedPath] : files;
  const local = [];
  for (const candidate of candidates) {
    const rel = relative(localD1Directory, candidate);
    if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || resolve(candidate) !== candidate) throw new Error("The database must be a file inside this checkout's local Wrangler D1 state directory.");
    const status = await lstat(candidate).catch((error) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (!status?.isFile() || status.isSymbolicLink()) continue;
    let database;
    try {
      database = new DatabaseSync(candidate, { readOnly: true });
      const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
      if (tables.has("bookings") && tables.has("event_types")) local.push(candidate);
    } catch {
      // Miniflare metadata files can share the local D1 directory; only a readable
      // SQLite database with the product schema is a seed target.
    } finally {
      database?.close();
    }
  }
  if (local.length !== 1) throw new Error(local.length === 0
    ? "No initialized local D1 database was found. Run local setup and at least one migration first."
    : `More than one local D1 database has the Dial schema (${local.map((path) => path.split(sep).at(-1)).join(", ")}); pass --database with the intended file name.`);
  return local[0];
}

function d1Directory(persistDirectory) {
  if (!persistDirectory) return defaultD1Directory;
  const wranglerRoot = join(root, ".wrangler");
  const persistRoot = resolve(root, persistDirectory);
  const relativePath = relative(wranglerRoot, persistRoot);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error("A custom persistence directory must be inside this checkout's .wrangler directory.");
  }
  return join(persistRoot, "v3", "d1", "miniflare-D1DatabaseObject");
}

async function assertDirectoryTree(directory) {
  let current = root;
  const relativeDirectory = relative(root, directory);
  for (const part of relativeDirectory.split(sep)) {
    current = join(current, part);
    const status = await lstat(current).catch((error) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (!status?.isDirectory() || status.isSymbolicLink()) throw new Error("The local Wrangler D1 state directory is missing or not a real directory.");
  }
}

function bookingStart(index) {
  if (index % 2 === 0) return new Date(Date.UTC(2035, index % 12, (index % 27) + 1, 9 + index % 8, index % 4 * 15)).toISOString();
  return new Date(Date.UTC(2022, index % 12, (index % 27) + 1, 9 + index % 8, index % 4 * 15)).toISOString();
}

export async function verifyPersistedSearch(persistDirectory) {
  const path = await findDatabase(undefined, d1Directory(persistDirectory));
  const db = new DatabaseSync(path, { readOnly: true });
  let checked = 0;
  try {
    for (const row of db.prepare("SELECT invitee_name,invitee_email,invitee_name_folded,invitee_email_folded FROM bookings").iterate()) {
      if (row.invitee_name_folded !== foldBookingSearch(row.invitee_name) || row.invitee_email_folded !== foldBookingSearch(row.invitee_email)) throw new Error("A persisted booking is not normalized after the native migration.");
      checked++;
    }
    return checked;
  } finally { db.close(); }
}
