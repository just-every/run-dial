import { createOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { createId, nowIso } from "../../shared/ids";
import { foldEmail } from "../erasure";
import { renderBrandedMail } from "../delivery/mail";
import type { BookingsService } from "../bookings";

export class RememberedDetails {
  constructor(private readonly db: D1Database, private readonly secret: string, private readonly origin: string, private readonly bookings: BookingsService) {}
  private event(handle: string, slug: string) { return this.db.prepare("SELECT e.id FROM event_types e WHERE e.slug=? AND e.status='published' AND EXISTS(SELECT 1 FROM host_profiles WHERE handle=?)").bind(slug,handle).first<{id:string}>(); }
  /** Known and unknown addresses receive exactly the same acknowledgement. The recipient comes only from a stored booking. */
  async request(handle: string, slug: string, raw: string) {
    const event=await this.event(handle,slug);
    if (!event) return;
    const email=foldEmail(raw), token=createOpaqueToken(), id=createId(), now=nowIso();
    const source=await this.db.prepare("SELECT id,invitee_email AS email FROM bookings WHERE event_type_id=? AND invitee_email_folded=? ORDER BY created_at DESC,id DESC LIMIT 1").bind(event.id,email).first<{id:string;email:string}>();
    if (!source) return;
    const url=new URL(`/book/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`,this.origin); url.searchParams.set("remember",token);
    const text=`Use your saved booking details\nOpen ${url.href}\nThen choose Use saved details on the booking form. This link works once and expires in 15 minutes.`;
    const payload={to:source.email,subject:"Your saved booking details",text,html:renderBrandedMail({businessName:"Dial",heading:"Your saved booking details",intro:"This link works once and expires in 15 minutes.",facts:[{label:"Open the booking page",value:url.href}]}),clientRememberId:id};
    await this.db.batch([
      this.db.prepare(`INSERT INTO client_remember_links(id,event_type_id,booking_id,email,token_hash,expires_at,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM bookings WHERE id=? AND invitee_email_folded=?)
          AND NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=?)
          AND NOT EXISTS(SELECT 1 FROM client_remember_links WHERE email=? AND event_type_id=? AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))`)
        .bind(id,event.id,source.id,email,await hashToken(token,this.secret),new Date(Date.now()+15*60_000).toISOString(),now,now,source.id,email,email,email,event.id),
      this.db.prepare("INSERT INTO delivery_outbox(id,kind,idempotency_key,payload_json,state,attempts,next_attempt_at,created_at,updated_at) SELECT ?,'mail_send',?,?,'pending',0,?,?,? WHERE EXISTS(SELECT 1 FROM client_remember_links WHERE id=?)").bind(createId(),`client-remember:${id}`,JSON.stringify(payload),now,now,now,id),
    ]);
  }
  async redeem(handle: string, slug: string, token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const event=await this.event(handle,slug); if(!event)return null;
    const hash=await hashToken(token,this.secret);
    const link=await this.db.prepare("SELECT id,booking_id AS bookingId,email FROM client_remember_links WHERE token_hash=? AND event_type_id=? AND consumed_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(hash,event.id).first<{id:string;bookingId:string;email:string}>();
    if(!link)return null;
    const result=await this.db.prepare("UPDATE client_remember_links SET consumed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND token_hash=? AND event_type_id=? AND consumed_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=?)").bind(link.id,hash,event.id,link.email).run();
    if(!result.meta.changes)return null;
    const booking=await this.bookings.getForOperator(link.bookingId); if(!booking)return null;
    return {name:booking.inviteeName,email:booking.inviteeEmail,answers:Object.fromEntries(booking.answers.map(answer=>[answer.key,answer.value])),...(booking.locationType==="invitee_phone"?{phone:booking.locationValue}:{})};
  }
}
