import { offeredHoldPredicate, type OfferedSlot } from "./holds";
import { createId, nowIso } from "../../shared/ids";
import type { BookingLinkInput, BookingLinkRecord } from "./types";
const fields = "l.offered_slots_json AS offeredSlotsJson,l.hold_until AS holdUntil,l.id,l.event_type_id AS eventTypeId,l.kind,l.overrides_json AS overridesJson,l.expires_at AS expiresAt,l.consumed_at AS consumedAt,l.consumed_booking_id AS consumedBookingId,l.revoked_at AS revokedAt,l.created_at AS createdAt,l.updated_at AS updatedAt,t.token_hash AS tokenHash";
export class BookingLinksRepository {
  constructor(private readonly db: D1Database) {}
  async list() { return (await this.db.prepare(`SELECT ${fields} FROM booking_links l LEFT JOIN booking_link_tokens t ON t.link_id=l.id ORDER BY l.created_at DESC`).all<BookingLinkRecord>()).results; }
  async byToken(hash: string) { return this.db.prepare(`SELECT ${fields} FROM booking_links l JOIN booking_link_tokens t ON t.link_id=l.id WHERE t.token_hash=?`).bind(hash).first<BookingLinkRecord>(); }
  async byBooking(bookingId:string) { return this.db.prepare(`SELECT ${fields} FROM booking_links l LEFT JOIN booking_link_tokens t ON t.link_id=l.id WHERE l.consumed_booking_id=?`).bind(bookingId).first<BookingLinkRecord>(); }
  async create(input: BookingLinkInput, tokenHash: string, slots?: OfferedSlot[]) {
    const id = createId(), now = nowIso();
    const holdUntil = input.holdHours ? new Date(Math.min(Date.parse(input.expiresAt),Date.parse(now)+input.holdHours*3600000)).toISOString() : null;
    const guards = (slots ?? []).map(slot=> {
      const hold=offeredHoldPredicate(slot.occupiedStartAt,slot.occupiedEndAt);
      return {sql:`NOT EXISTS(SELECT 1 FROM booking_occurrences o JOIN bookings b ON b.id=o.booking_id WHERE o.is_current=1 AND o.blocks_time=1 AND b.state IN ('confirmed','rescheduled') AND o.occupied_start_at<? AND o.occupied_end_at>?) AND ${hold.sql}`,params:[slot.occupiedEndAt,slot.occupiedStartAt,...hold.params]};
    });
    const results = await this.db.batch([
      this.db.prepare(`INSERT INTO booking_links(id,event_type_id,kind,overrides_json,expires_at,created_at,updated_at,offered_slots_json,hold_until) SELECT ?,?,?,?,?,?,?,?,? WHERE ${guards.map(g=>`(${g.sql})`).join(" AND ") || "1"}`).bind(id,input.eventTypeId,input.kind,input.overrides ? JSON.stringify(input.overrides) : null,input.expiresAt,now,now,slots ? JSON.stringify(slots) : null,holdUntil,...guards.flatMap(g=>g.params)),
      this.db.prepare("INSERT INTO booking_link_tokens(id,link_id,token_hash,created_at,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM booking_links WHERE id=?)").bind(createId(),id,tokenHash,now,now,id),
    ]);
    return results[0].meta.changes ? id : undefined;
  }
  async revoke(id: string) { const now=nowIso(); return this.db.prepare("UPDATE booking_links SET revoked_at=?,updated_at=? WHERE id=? AND revoked_at IS NULL RETURNING id").bind(now,now,id).first(); }
}
