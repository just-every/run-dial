import { createId, nowIso } from "../../shared/ids";
import type { BookingLinkInput, BookingLinkRecord } from "./types";
const fields = "l.id,l.event_type_id AS eventTypeId,l.kind,l.overrides_json AS overridesJson,l.expires_at AS expiresAt,l.consumed_at AS consumedAt,l.consumed_booking_id AS consumedBookingId,l.revoked_at AS revokedAt,l.created_at AS createdAt,l.updated_at AS updatedAt,t.token_hash AS tokenHash";
export class BookingLinksRepository {
  constructor(private readonly db: D1Database) {}
  async list() { return (await this.db.prepare(`SELECT ${fields} FROM booking_links l LEFT JOIN booking_link_tokens t ON t.link_id=l.id ORDER BY l.created_at DESC`).all<BookingLinkRecord>()).results; }
  async byToken(hash: string) { return this.db.prepare(`SELECT ${fields} FROM booking_links l JOIN booking_link_tokens t ON t.link_id=l.id WHERE t.token_hash=?`).bind(hash).first<BookingLinkRecord>(); }
  async byBooking(bookingId:string) { return this.db.prepare(`SELECT ${fields} FROM booking_links l LEFT JOIN booking_link_tokens t ON t.link_id=l.id WHERE l.consumed_booking_id=?`).bind(bookingId).first<BookingLinkRecord>(); }
  async create(input: BookingLinkInput, tokenHash: string) {
    const id = createId(), now = nowIso();
    await this.db.batch([
      this.db.prepare("INSERT INTO booking_links(id,event_type_id,kind,overrides_json,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id,input.eventTypeId,input.kind,input.overrides ? JSON.stringify(input.overrides) : null,input.expiresAt,now,now),
      this.db.prepare("INSERT INTO booking_link_tokens(id,link_id,token_hash,created_at,updated_at) VALUES(?,?,?,?,?)").bind(createId(),id,tokenHash,now,now),
    ]);
    return id;
  }
  async revoke(id: string) { const now=nowIso(); return this.db.prepare("UPDATE booking_links SET revoked_at=?,updated_at=? WHERE id=? AND revoked_at IS NULL RETURNING id").bind(now,now,id).first(); }
}
