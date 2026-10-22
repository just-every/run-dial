/** REPORT-001's seeded month, synthetic: March 2026 for a host in America/New_York, whose clocks moved on 8 March.
 * Rows are written straight to the tables with exact instants; the hand counts live in tests/scheduling-report.test.mjs. */
type Seed = { name: string; event: "intro" | "deep"; created: string; first: string; current?: string; minutes: number; state: "confirmed" | "rescheduled" | "cancelled"; cancelled?: { at: string; reason: string | null };
  attendance?: "attended" | "no_show"; moves?: string[]; imported?: boolean; attribution?: Record<string, string>; paid?: { at: string; cents: number } };
const z = (day: string, time: string) => `2026-${day}T${time}:00.000Z`;

export const reportMonth: Seed[] = [
  { name: "Ada", event: "intro", created: z("03-02", "15:00"), first: z("03-04", "15:00"), minutes: 30, state: "confirmed", attendance: "attended", attribution: { utm_source: "newsletter", utm_medium: "email", source: "homepage" } },
  { name: "Bea", event: "intro", created: z("03-02", "16:00"), first: z("03-03", "16:00"), minutes: 30, state: "confirmed", attendance: "no_show", attribution: { utm_source: "newsletter" } },
  { name: "Cy", event: "intro", created: z("03-03", "12:00"), first: z("03-10", "14:00"), minutes: 30, state: "confirmed", attendance: "attended", attribution: { utm_source: "partner", source: "homepage" } },
  { name: "Dee", event: "intro", created: z("03-04", "09:00"), first: z("03-04", "21:00"), minutes: 30, state: "cancelled", cancelled: { at: z("03-04", "10:00"), reason: "Plans changed" } },
  { name: "Eli", event: "deep", created: z("03-05", "18:00"), first: z("03-08", "14:00"), current: z("03-12", "15:00"), minutes: 60, state: "rescheduled", moves: [z("03-06", "12:00")], attribution: { utm_source: "partner", utm_campaign: "spring" } },
  { name: "Fay", event: "intro", created: z("03-06", "20:00"), first: z("03-08", "07:30"), minutes: 30, state: "confirmed", attendance: "attended", attribution: { source: "homepage" } },
  { name: "Gus", event: "intro", created: z("03-07", "10:00"), first: z("03-08", "06:30"), minutes: 30, state: "confirmed", attendance: "attended", attribution: { utm_source: "newsletter", utm_medium: "email" } },
  { name: "Hal", event: "intro", created: z("03-10", "10:00"), first: z("03-31", "03:30"), minutes: 30, state: "confirmed" },
  { name: "Ivy", event: "deep", created: z("03-11", "10:00"), first: z("04-01", "03:30"), minutes: 60, state: "confirmed" },
  { name: "Jo", event: "intro", created: z("03-12", "10:00"), first: z("04-01", "04:30"), minutes: 30, state: "confirmed" },
  { name: "Kim", event: "intro", created: z("02-27", "10:00"), first: z("03-01", "05:30"), minutes: 30, state: "confirmed", attendance: "attended" },
  { name: "Lou", event: "intro", created: z("02-27", "11:00"), first: z("03-01", "04:30"), minutes: 30, state: "confirmed", attendance: "attended" },
  { name: "Max", event: "intro", created: z("03-15", "10:00"), first: z("03-20", "16:00"), minutes: 30, state: "confirmed", imported: true },
  { name: "Nia", event: "intro", created: z("03-17", "10:00"), first: z("03-19", "10:00"), minutes: 30, state: "cancelled", cancelled: { at: z("03-18", "12:00"), reason: "Plans changed" }, attribution: { source: "homepage" } },
  { name: "Oz", event: "intro", created: z("03-18", "10:00"), first: z("03-25", "10:00"), minutes: 30, state: "cancelled", cancelled: { at: z("03-20", "09:00"), reason: "Found another provider" }, attribution: { utm_source: "partner" } },
  { name: "Pam", event: "intro", created: z("03-19", "10:00"), first: z("03-26", "10:00"), minutes: 30, state: "cancelled", cancelled: { at: z("03-21", "09:00"), reason: null } },
  { name: "Quin", event: "intro", created: z("03-20", "10:00"), first: z("04-10", "10:00"), minutes: 30, state: "cancelled", cancelled: { at: z("04-02", "09:00"), reason: "Plans changed" } },
  { name: "Rae", event: "deep", created: z("03-16", "10:00"), first: z("03-17", "15:00"), minutes: 60, state: "confirmed", attendance: "attended", attribution: { utm_source: "newsletter" }, paid: { at: z("03-16", "10:05"), cents: 9000 } },
  { name: "Sue", event: "intro", created: z("03-17", "11:00"), first: z("03-18", "15:00"), minutes: 30, state: "confirmed", attendance: "no_show", paid: { at: z("03-17", "11:05"), cents: 5000 } },
  { name: "Tom", event: "intro", created: z("03-09", "10:00"), first: z("03-30", "14:00"), current: z("03-30", "16:00"), minutes: 30, state: "rescheduled", moves: [z("03-10", "10:00"), z("03-11", "10:00")] },
  { name: "Uma", event: "intro", created: z("03-13", "10:00"), first: z("03-27", "14:00"), current: z("04-06", "14:00"), minutes: 30, state: "rescheduled", moves: [z("04-05", "10:00")] },
];

const add = (instant: string, minutes: number) => new Date(Date.parse(instant) + minutes * 60_000).toISOString();

export async function seedReportMonth(db: D1Database, input: { operatorId: string; events: Record<"intro" | "deep", { id: string; slug: string; title: string }> }) {
  const statements: D1PreparedStatement[] = [];
  for (const [index, seed] of reportMonth.entries()) {
    const id = `qa-report-${String(index + 1).padStart(16, "0")}`, event = input.events[seed.event], current = seed.current ?? seed.first;
    const firstOccurrence = `qa-report-first-${String(index + 1).padStart(10, "0")}`, currentOccurrence = seed.current ? `qa-report-now-${String(index + 1).padStart(12, "0")}` : firstOccurrence;
    statements.push(
      db.prepare(`INSERT INTO bookings (id, event_type_id, event_slug, event_title, duration_minutes, location_type, location_label, location_value, invitee_name, invitee_email, host_timezone, invitee_timezone, state, ical_uid, calendar_required, calendar_state, meeting_state, current_occurrence_id, created_at, updated_at, cancelled_at, cancelled_reason, attribution_json, imported)
        VALUES (?, ?, ?, ?, ?, 'fixed_link', 'Video room', 'https://meet.example.test/room', ?, ?, 'America/New_York', 'UTC', ?, ?, 0, 'succeeded', 'not_required', NULL, ?, ?, ?, ?, ?, ?)`)
        .bind(id, event.id, event.slug, event.title, seed.minutes, seed.name, `${seed.name.toLowerCase()}@report.test`, seed.state, `${id}@report.invalid`, seed.created, seed.created, seed.cancelled?.at ?? null, seed.cancelled?.reason ?? null, JSON.stringify(seed.attribution ?? {}), seed.imported ? 1 : 0),
      db.prepare(`INSERT INTO booking_occurrences (id, booking_id, sequence, start_at, end_at, occupied_start_at, occupied_end_at, host_date, state, is_current, created_at) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(firstOccurrence, id, seed.first, add(seed.first, seed.minutes), seed.first, add(seed.first, seed.minutes), seed.first.slice(0, 10), seed.current ? "rescheduled" : seed.state === "cancelled" ? "cancelled" : "current", seed.current ? 0 : 1, seed.created),
    );
    if (seed.current) statements.push(db.prepare(`INSERT INTO booking_occurrences (id, booking_id, sequence, start_at, end_at, occupied_start_at, occupied_end_at, host_date, state, is_current, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'current', 1, ?)`)
      .bind(currentOccurrence, id, current, add(current, seed.minutes), current, add(current, seed.minutes), current.slice(0, 10), seed.moves?.[0] ?? seed.created));
    statements.push(db.prepare("UPDATE bookings SET current_occurrence_id = ? WHERE id = ?").bind(currentOccurrence, id));
    for (const [move, at] of (seed.moves ?? []).entries()) statements.push(db.prepare("INSERT INTO booking_history (id, booking_id, occurrence_id, action, actor_type, actor_id, previous_start_at, new_start_at, created_at) VALUES (?, ?, ?, 'rescheduled', 'invitee', NULL, ?, ?, ?)").bind(`qa-report-move-${String(index + 1).padStart(8, "0")}-${move}`, id, currentOccurrence, seed.first, current, at));
    if (seed.attendance) statements.push(db.prepare("INSERT INTO booking_attendance (booking_id, status, note, marked_by_operator_id, marked_at) VALUES (?, ?, 'Seeded mark', ?, ?)").bind(id, seed.attendance, input.operatorId, add(current, seed.minutes + 5)));
    if (seed.paid) statements.push(db.prepare(`INSERT INTO booking_payments (id, booking_id, provider, account_id, amount_cents, currency, checkout_session_id, payment_intent_id, status, paid_at, created_at, updated_at) VALUES (?, ?, 'stripe', 'acct_wirehost', ?, 'usd', ?, NULL, 'paid', ?, ?, ?)`)
      .bind(`qa-report-pay-${String(index + 1).padStart(12, "0")}`, id, seed.paid.cents, `cs_test_report_${index + 1}`, seed.paid.at, seed.paid.at, seed.paid.at));
  }
  await db.batch(statements);
  return { count: reportMonth.length };
}
