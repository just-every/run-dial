import { Hono } from "hono";
import { authenticateCredential, requireScope } from "../api-credentials/auth";
import { BookingsRepository } from "../bookings/repository";
import { createId } from "../../shared/ids";
import { validate } from "../../shared/validation";
import { bookingAllowed, bookingView, eventAllowed, hostAllowed, idempotent, rateLimit, refusal, type ApiEnvironment } from "./support";
import { resourceRoutes } from "./resources";
import { openApiDocument } from "./spec";
import { apiAvailabilityQuerySchema as availability, apiBookingCreateSchema as create, apiCancellationSchema as cancellation, apiRescheduleSchema as reschedule, apiAttendanceSchema as attendance } from "./request-schemas";

const error=(code:string,message="This request cannot be completed.")=>({error:{code,message,request_id:createId()}});

export const publicApiRoutes=new Hono<ApiEnvironment>()
  .use("/api/v1/*",async(c,next)=>{
    c.header("Cache-Control","private, no-store");
    c.header("Referrer-Policy","no-referrer");
    const credential=await authenticateCredential(c);
    if(credential instanceof Response)return credential;
    c.set("apiCredential",credential);
    const limited=await rateLimit(c,credential);if(limited)return limited;
    const read=c.req.method==="GET",path=c.req.path;
    const scope=path.includes("webhook")?"webhooks:manage":path.includes("routing")?"routing:manage":(path.includes("event-types")||path.includes("teams")||path.includes("polls"))&&!read?"event-types:manage":read?"bookings:read":"bookings:write";
    const configurationRead=read&&(path.includes("event-types")||path.includes("teams")||path.includes("polls"))&&credential.scopes.includes("event-types:manage");
    const denied=path.endsWith("/openapi.json")||configurationRead?undefined:await requireScope(c,credential,scope);if(denied)return denied;
    if(!await hostAllowed(c,credential))return refusal(c,404,"not_found","This record does not exist.");
    await next();
  })
  .get("/api/v1/openapi.json",c=>c.json(openApiDocument))
  .get("/api/v1/availability",validate("query",availability),async c=>{
    const query=c.req.valid("query"),credential=c.get("apiCredential");
    const profile=await hostAllowed(c,credential),event=await c.get("services").eventTypes.getEventType(query.eventTypeId);
    if(!profile||!event||!await eventAllowed(c,credential,event.id))return refusal(c,404,"not_found","This event type does not exist.");
    const result=await c.get("services").availability.listPublicWeek(profile.handle,event.slug,query.week,query.inviteeTimezone,new Date(),query.durationMinutes);
    if(!result)return refusal(c,404,"not_found","This event type is not publicly available.");
    if("kind" in result)return refusal(c,422,result.kind,"The event selection is unavailable.");
    return c.json(result,result.state==="temporarily_unavailable"?503:200);
  })
  .get("/api/v1/bookings",async c=>{
    const credential=c.get("apiCredential"),limit=Number(c.req.query("limit")??"50");let after="";
    if(!Number.isInteger(limit)||limit<1||limit>100)return refusal(c,400,"invalid_pagination","Choose a limit from 1 to 100.");
    try{if(c.req.query("cursor")){after=atob(c.req.query("cursor")!);if(!/^[0-9A-Z]{26}$/.test(after))throw new Error();}}catch{return refusal(c,400,"invalid_cursor","This cursor is invalid.");}
    const ids=(await c.env.DB.prepare(`SELECT id FROM bookings b WHERE id>? AND (? IS NULL OR EXISTS(SELECT 1 FROM team_event_types t WHERE t.team_id=? AND t.event_type_id=b.event_type_id)) ORDER BY id LIMIT ?`)
      .bind(after,credential.teamId,credential.teamId,limit+1).all<{id:string}>()).results;
    const data=[];
    for(const row of ids.slice(0,limit)){const booking=await bookingAllowed(c,credential,row.id);if(booking)data.push(bookingView(booking));}
    return c.json({data,nextCursor:ids.length>limit?btoa(ids[limit-1].id):null});
  })
  .get("/api/v1/bookings/:id",async c=>{
    const booking=await bookingAllowed(c,c.get("apiCredential"),c.req.param("id"));
    return booking?c.json(bookingView(booking)):refusal(c,404,"not_found","This booking does not exist.");
  })
  .post("/api/v1/bookings",validate("json",create),async c=>{
    const body=c.req.valid("json"),credential=c.get("apiCredential"),services=c.get("services");
    const event=await services.eventTypes.getEventType(body.eventTypeId),profile=await hostAllowed(c,credential);
    if(!event||!profile||!await eventAllowed(c,credential,event.id))return refusal(c,404,"not_found","This event type does not exist.");
    return idempotent(c,body,async()=>{
      const selected=await services.bookings.issuePublicSelection(profile.handle,event.slug,body.startAt,body.inviteeTimezone,body.durationMinutes);
      if(selected.kind!=="issued")return {status:selected.kind==="calendar_unavailable"?503:422,body:error(selected.kind)};
      const result=await services.bookings.confirmPublic({...body,handle:profile.handle,slug:event.slug,nonce:selected.nonce.nonce});
      if(result.kind==="created"||result.kind==="replayed"){
        const booking=result.booking.bookingReference?await services.bookings.getForOperator(result.booking.bookingReference):undefined;
        if(!booking)throw new Error("api_booking_missing");
        return {status:201,body:bookingView(booking),bookingId:booking.id};
      }
      if(result.kind==="approval_required"||result.kind==="payment_required")return {status:202,body:{state:result.kind}};
      return {status:result.kind==="calendar_unavailable"||result.kind==="payments_unavailable"?503:422,body:error(result.kind)};
    });
  })
  .post("/api/v1/bookings/:id/cancel",validate("json",cancellation),async c=>{
    const booking=await bookingAllowed(c,c.get("apiCredential"),c.req.param("id"));
    if(!booking)return refusal(c,404,"not_found","This booking does not exist.");
    const body=c.req.valid("json");
    return idempotent(c,body,async()=>{
      const token=await manageToken(c,booking.id);
      if(!token)return {status:409,body:error("management_capability_unavailable")};
      const result=await c.get("services").bookings.cancelByManageToken(token,body.reason);
      if(result.kind!=="cancelled")return {status:409,body:error("reason" in result&&result.reason?result.reason:result.kind)};
      const updated=await c.get("services").bookings.getForOperator(booking.id);
      if(!updated)throw new Error("api_booking_missing");
      return {status:200,body:bookingView(updated),bookingId:booking.id};
    });
  })
  .post("/api/v1/bookings/:id/reschedule",validate("json",reschedule),async c=>{
    const booking=await bookingAllowed(c,c.get("apiCredential"),c.req.param("id"));
    if(!booking)return refusal(c,404,"not_found","This booking does not exist.");
    const body=c.req.valid("json");
    return idempotent(c,body,async()=>{
      const token=await manageToken(c,booking.id);
      if(!token)return {status:409,body:error("management_capability_unavailable")};
      const selected=await c.get("services").bookings.issueRescheduleSelection(token,body.startAt,body.inviteeTimezone,body.durationMinutes);
      if(selected.kind!=="issued")return {status:422,body:error("reason" in selected&&selected.reason?selected.reason:selected.kind)};
      const result=await c.get("services").bookings.rescheduleByManageToken({...body,token,nonce:selected.nonce.nonce});
      if(result.kind!=="rescheduled"&&result.kind!=="replayed")return {status:422,body:error("reason" in result&&result.reason?result.reason:result.kind)};
      const updated=await c.get("services").bookings.getForOperator(booking.id);
      if(!updated)throw new Error("api_booking_missing");
      return {status:200,body:bookingView(updated),bookingId:booking.id};
    });
  })
  .post("/api/v1/bookings/:id/attendance",validate("json",attendance),async c=>{
    const booking=await bookingAllowed(c,c.get("apiCredential"),c.req.param("id"));
    if(!booking)return refusal(c,404,"not_found","This booking does not exist.");
    const body=c.req.valid("json");
    return idempotent(c,body,async()=>{
      const result=await c.get("services").bookings.markAttendance(booking.id,c.get("apiCredential").operatorId,body.status,body.note);
      return result.kind==="marked"&&result.booking?{status:200,body:bookingView(result.booking),bookingId:booking.id}:{status:409,body:error(result.kind)};
    });
  })
  .route("/",resourceRoutes);

async function manageToken(c:Parameters<typeof hostAllowed>[0],id:string){
  const url=await new BookingsRepository(c.env.DB).storedManageUrl(id);
  if(!url)return undefined;
  const parsed=new URL(url);
  return parsed.origin===new URL(c.get("runtime").APP_URL).origin&&parsed.pathname.startsWith("/manage/")?parsed.pathname.slice("/manage/".length):undefined;
}
