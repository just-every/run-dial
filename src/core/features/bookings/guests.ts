import { foldBookingSearch } from "./search/case-fold.mjs";
import { createId, nowIso } from "../../shared/ids";
import { renderBrandedMail } from "../delivery/mail";
import type { BookingClaim, BookingEmail, BookingRecord } from "./types";

/** EVENT-009 guests receive the meeting, never the invitee's answers, payment details or manage capability. */
export function guestNotice(input: { eventTitle: string; startAt: string; endAt: string; location?: string }, to: string, kind: "confirmation" | "reschedule" | "cancellation"): BookingEmail {
  const heading = kind === "cancellation" ? "Guest invitation cancelled" : kind === "reschedule" ? "Guest invitation changed" : "Guest invitation confirmed";
  const facts = [{ label: "Event", value: input.eventTitle }, { label: "Time (UTC)", value: `${input.startAt} – ${input.endAt}` }, ...(input.location ? [{ label: "Location", value: input.location }] : [])];
  return { guest: true, to, recipientRole: "invitee", subject: `${heading}: ${input.eventTitle}`, text: `${heading}\n${facts.map(f => `${f.label}: ${f.value}`).join("\n")}`, html: renderBrandedMail({ businessName: "Dial", heading, intro: "The invitee manages the booking and its guests.", facts }) };
}

export function normalizedGuests(candidate: unknown, inviteeEmail: string, limit: number): string[] | undefined {
  if (candidate === undefined) return [];
  if (!Array.isArray(candidate) || candidate.length > limit || candidate.some(email => typeof email !== "string" || email.trim().length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim()))) return undefined;
  const guests = candidate.map(email => (email as string).trim().toLowerCase());
  return new Set(guests).size !== guests.length || guests.includes(inviteeEmail.trim().toLowerCase()) ? undefined : guests;
}

export class GuestsRepository {
  constructor(private readonly db: D1Database) {}
  async limit(eventId: string) { return (await this.db.prepare("SELECT guest_limit AS n FROM event_types WHERE id=?").bind(eventId).first<{n:number}>())?.n ?? 0; }
  async saveLimit(eventId: string, limit: number) { const result = await this.db.prepare("UPDATE event_types SET guest_limit=?, updated_at=? WHERE id=?").bind(limit, nowIso(), eventId).run(); return result.meta.changes > 0; }
  async list(bookingId: string) { return (await this.db.prepare("SELECT email FROM booking_guests WHERE booking_id=? ORDER BY email").bind(bookingId).all<{email:string}>()).results.map(row => row.email); }
  async bookingLimit(bookingId: string) { return (await this.db.prepare("SELECT guest_limit AS n FROM bookings WHERE id=?").bind(bookingId).first<{n:number}>())?.n ?? 0; }
  claimStatements(input: Pick<BookingClaim,"bookingId"|"event"|"invitee"|"now">) {
    return [...(input.invitee.guests ?? []).map(email => this.erasureGuard(email)), this.db.prepare("UPDATE bookings SET guest_limit=(SELECT guest_limit FROM event_types WHERE id=?) WHERE id=?").bind(input.event.id,input.bookingId), ...(input.invitee.guests ?? []).map(email => this.db.prepare("INSERT INTO booking_guests(id,booking_id,email,created_at,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM bookings WHERE id=?)").bind(createId(),input.bookingId,email,input.now,input.now,input.bookingId))];
  }
  private erasureGuard(email: string) { return this.db.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=?) THEN 1 ELSE abs(-9223372036854775808) END").bind(foldBookingSearch(email)); }
  /** Diff and notices are computed by SQLite in one batch, so a retry of the same list sends nothing twice. */
  async replace(booking: BookingRecord, guests: string[]) {
    const now=nowIso(), operation=createId(), list=JSON.stringify(guests), id=booking.id;
    const active="EXISTS(SELECT 1 FROM bookings WHERE id=? AND state<>'cancelled')";
    const before=await this.list(id);
    const added=guests.filter(email=>!before.includes(email)), removed=before.filter(email=>!guests.includes(email));
    const statements:D1PreparedStatement[]=guests.map(email=>this.erasureGuard(email));
    for (const [emails,kind] of [[added,"confirmation"],[removed,"cancellation"]] as const) for(const email of emails){
      const notice=guestNotice({eventTitle:booking.eventTitle,startAt:booking.occurrence.startAt,endAt:booking.occurrence.endAt,location:booking.meetingUrl??booking.locationValue},email,kind);
      const membership=kind==="confirmation"?"NOT EXISTS":"EXISTS";
      statements.push(this.db.prepare(`INSERT INTO delivery_outbox(id,kind,idempotency_key,booking_id,occurrence_id,payload_json,state,attempts,next_attempt_at,created_at,updated_at) SELECT ?,'mail_send',?,?,?,?, 'pending',0,?,?,? WHERE ${active} AND ${membership}(SELECT 1 FROM booking_guests WHERE booking_id=? AND email=?) ON CONFLICT(idempotency_key) DO NOTHING`).bind(createId(),`booking:${id}:guests:${operation}:${kind}:${email}`,id,booking.occurrence.id,JSON.stringify(notice),now,now,now,id,id,email));
    }
    // A new calendar command patches the existing managed event with the live guest list at dispatch time.
    if(booking.calendarState!=="not_required") statements.push(this.db.prepare(`INSERT INTO delivery_outbox(id,kind,idempotency_key,booking_id,occurrence_id,payload_json,state,attempts,next_attempt_at,created_at,updated_at) SELECT ?,'calendar_upsert',?,?,?,?,'pending',0,?,?,? WHERE ${active} AND ((SELECT json_group_array(email) FROM (SELECT email FROM booking_guests WHERE booking_id=? ORDER BY email))<>?)`).bind(createId(),`booking:${id}:guests:${operation}:calendar`,id,booking.occurrence.id,JSON.stringify({bookingId:id,icalUid:booking.icalUid,eventTitle:booking.eventTitle,startAt:booking.occurrence.startAt,endAt:booking.occurrence.endAt,hostTimezone:booking.hostTimezone,lockedTimezone:booking.lockedTimezone,invitee:{name:booking.inviteeName,email:booking.inviteeEmail},location:booking.locationValue,locationType:booking.locationType}),now,now,now,id,id,JSON.stringify([...guests].sort())));
    statements.push(this.db.prepare(`DELETE FROM booking_guests WHERE booking_id=? AND email NOT IN(SELECT value FROM json_each(?)) AND ${active}`).bind(id,list,id));
    for(const email of guests) statements.push(this.db.prepare(`INSERT INTO booking_guests(id,booking_id,email,created_at,updated_at) SELECT ?,?,?,?,? WHERE ${active} ON CONFLICT(booking_id,email) DO NOTHING`).bind(createId(),id,email,now,now,id));
    await this.db.batch(statements);
  }
}
