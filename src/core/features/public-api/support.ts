import type { Context } from "hono";
import seed from "../../../../seed.json";
import type { AppEnvironment } from "../../app/context";
import { createId } from "../../shared/ids";
import { hashToken } from "../../platform/auth/tokens";
import { stableJson } from "../../shared/stable-json";
import type { Credential } from "../api-credentials";
import type { BookingRecord } from "../bookings";

export type ApiEnvironment = AppEnvironment;
export function refusal(c: Context<AppEnvironment>, status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 503, code: string, message: string) {
  return c.json({ error: { code, message, request_id: createId() } }, status);
}

export async function rateLimit(c: Context<AppEnvironment>, credential: Credential) {
  const limit = seed.limits.publicApiRequestsPerMinute;
  const started = Math.floor(Date.now() / 60_000) * 60_000;
  const window = new Date(started).toISOString(), expires = new Date(started + 60_000).toISOString();
  const row = await c.get("apiDatabase").prepare(`INSERT INTO api_rate_windows(id,credential_id,window_started_at,request_count,expires_at) VALUES(?,?,?,1,?)
    ON CONFLICT(credential_id,window_started_at) DO UPDATE SET request_count=request_count+1 RETURNING request_count AS count`)
    .bind(`${credential.id}-${window}`, credential.id, window, expires).first<{count:number}>();
  if (!row) throw new Error("api_rate_window_unavailable");
  c.header("X-RateLimit-Limit", String(limit));
  c.header("X-RateLimit-Remaining", String(Math.max(0,limit-row.count)));
  c.header("X-RateLimit-Reset", String(Math.ceil((started+60_000)/1000)));
  if (row.count > limit) {
    c.header("Retry-After", String(Math.max(1,Math.ceil((started+60_000-Date.now())/1000))));
    return refusal(c,429,"rate_limited","Wait before using this credential again.");
  }
}

export async function hostAllowed(c: Context<AppEnvironment>, credential: Credential) {
  const host = await c.get("services").hostProfile.getProfile();
  return host && (!credential.hostId || credential.hostId === host.id) ? host : undefined;
}
export async function eventAllowed(c: Context<AppEnvironment>, credential: Credential, eventTypeId: string) {
  if (!await hostAllowed(c,credential)) return false;
  if (!credential.teamId) return true;
  return Boolean(await c.get("apiDatabase").prepare("SELECT event_type_id FROM team_event_types WHERE team_id=? AND event_type_id=?").bind(credential.teamId,eventTypeId).first());
}
export async function bookingAllowed(c: Context<AppEnvironment>, credential: Credential, id: string) {
  const booking = await c.get("services").bookings.getForOperator(id);
  return booking?.eventTypeId && await eventAllowed(c,credential,booking.eventTypeId) ? booking : undefined;
}
/** API readers never receive mail bodies, management capabilities or processor authority. */
export function bookingView(booking: BookingRecord) {
  return {id:booking.id,eventTypeId:booking.eventTypeId,eventTitle:booking.eventTitle,state:booking.state,
    inviteeName:booking.inviteeName,inviteeEmail:booking.inviteeEmail,inviteeTimezone:booking.inviteeTimezone,
    durationMinutes:booking.durationMinutes,occurrence:{startAt:booking.occurrence.startAt,endAt:booking.occurrence.endAt},
    attendance:booking.attendance,createdAt:booking.createdAt,updatedAt:booking.updatedAt,cancelledAt:booking.cancelledAt};
}

type Receipt = { state:"pending"|"completed"|"erased"; requestHash:string|null; responseJson:string|null;responseStatus:number|null;bookingId:string|null };
export async function idempotent(c: Context<ApiEnvironment>, body: unknown, execute: () => Promise<{body:unknown;status:number;bookingId?:string;replayBody?:unknown}>) {
  const key = c.req.header("Idempotency-Key");
  if (!key || key.length<16 || key.length>128 || /[\r\n]/.test(key)) return refusal(c,400,"idempotency_key_required","Supply an Idempotency-Key of 16 to 128 characters.");
  const credential=c.get("apiCredential"),secret=c.get("runtime").SESSION_SECRET;
  const keyHash=await hashToken(`api-key:${credential.id}:${key}`,secret);
  const requestHash=await hashToken(stableJson({method:c.req.method,path:c.req.path,body}),secret);
  const now=new Date().toISOString(),expires=new Date(Date.now()+86400000).toISOString();
  // A pending reservation is never stolen: a crash can hold the key for its
  // retention window, but can never admit a second mutation on that key.
  const inserted=await c.get("apiDatabase").prepare("INSERT OR IGNORE INTO api_request_keys(id,credential_id,key_hash,request_hash,state,created_at,expires_at) VALUES(?,?,?,?,'pending',?,?)")
    .bind(createId(),credential.id,keyHash,requestHash,now,expires).run();
  if (!inserted.meta.changes) {
    const prior=await c.get("apiDatabase").prepare("SELECT state,request_hash AS requestHash,response_json AS responseJson,response_status AS responseStatus,booking_id AS bookingId FROM api_request_keys WHERE credential_id=? AND key_hash=?")
      .bind(credential.id,keyHash).first<Receipt>();
    if (prior?.state==="erased") return refusal(c,410,"erased","This booking was erased. Start a new request.");
    if (prior?.requestHash!==requestHash) return refusal(c,409,"idempotency_key_reused","This key was used for different request details.");
    if(prior?.state==="completed" && prior.responseJson && prior.responseStatus){
      c.header("Idempotent-Replay","true");
      return c.newResponse(prior.responseJson,prior.responseStatus as 200,{"Content-Type":"application/json"});
    }
    c.header("Retry-After","1");
    return refusal(c,409,"request_in_progress","This request is still in progress.");
  }
  const result=await execute(),json=JSON.stringify(result.body);
  await c.get("apiDatabase").prepare("UPDATE api_request_keys SET state='completed',response_json=?,response_status=?,booking_id=? WHERE credential_id=? AND key_hash=? AND state='pending'")
    .bind(JSON.stringify(result.replayBody??result.body),result.status,result.bookingId??null,credential.id,keyHash).run();
  return c.newResponse(json,result.status as 200,{"Content-Type":"application/json"});
}

export function parsePage(c:Context<AppEnvironment>) {
  const limit=Number(c.req.query("limit")??"50"),cursor=c.req.query("cursor");
  if(!Number.isInteger(limit)||limit<1||limit>100)return refusal(c,400,"invalid_pagination","Choose a limit from 1 to 100.");
  let after="";
  if(cursor){try{after=atob(cursor);if(!/^[0-9A-Z]{26}$/.test(after))throw new Error();}catch{return refusal(c,400,"invalid_cursor","This cursor is invalid.");}}
  return {limit,after};
}
export function pageResult<T extends {id:string}>(c:Context<AppEnvironment>,rows:T[],limit:number){
  const data=rows.slice(0,limit);
  return c.json({data,nextCursor:rows.length>limit?btoa(data[data.length-1].id):null});
}
export function page<T extends {id:string}>(c:Context<AppEnvironment>,rows:T[]) {
  const bounds=parsePage(c);if(bounds instanceof Response)return bounds;
  const sorted=[...rows].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).filter(row=>row.id>bounds.after);
  return pageResult(c,sorted,bounds.limit);
}
