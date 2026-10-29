import { z } from "zod";
import { workflowInput,workflowPatch } from "../workflows";
import { eventTypeCreationSchema, eventTypeInputSchema } from "../event-types";
import { formSchema } from "../routing";
import { pollInput } from "../polls";
import { apiAttendanceSchema, apiAvailabilityQuerySchema, apiBookingCreateSchema, apiCancellationSchema, apiRescheduleSchema, apiRoutingSubmissionSchema, apiTeamSchema, apiWebhookSchema } from "./request-schemas";

const schema=(input:z.ZodType)=>z.toJSONSchema(input,{io:"input",unrepresentable:"any"});
const json=(shape:unknown)=>({"application/json":{schema:shape}});
const reference=(name:string)=>({$ref:`#/components/schemas/${name}`});
const pagination=[{in:"query",name:"limit",description:"Maximum records in this page.",schema:{type:"integer",minimum:1,maximum:100,default:50}},{in:"query",name:"cursor",description:"Opaque nextCursor from the preceding response.",schema:{type:"string"}}];
const idempotency={in:"header",name:"Idempotency-Key",required:true,description:"A credential-scoped key. Reuse only for the identical method, path and payload. A replay sends Idempotent-Replay: true.",schema:{type:"string",minLength:16,maxLength:128}};
const error={description:"A refused request. The code states the reason, and details may name invalid fields.",content:json(reference("ApiError"))};
const responseHeaders={"X-RateLimit-Limit":{description:"Requests permitted per credential in this minute.",schema:{type:"integer"}},"X-RateLimit-Remaining":{description:"Requests remaining in the current minute.",schema:{type:"integer"}},"X-RateLimit-Reset":{description:"Unix time in seconds when this rate window ends.",schema:{type:"integer"}}};
type Options={write?:boolean;input?:string;list?:boolean;query?:unknown[];description?:string;scopes?:string[]};
function operation(summary:string,options:Options={}){
 const parameters=[...(options.write?[idempotency]:[]),...(options.list?pagination:[]),...(options.query??[])];
 const success={description:options.list?"A cursor page of scoped resources.":"The requested resource.",headers:responseHeaders,content:json(options.list?reference("CursorPage"):{type:"object"})};
 return {summary,description:options.description,security:[{bearerAuth:[]}],"x-required-scopes":options.scopes??["bookings:read"],
  ...(parameters.length?{parameters}:{}),...(options.input?{requestBody:{required:true,content:json(reference(options.input))}}:{}),
  responses:{"200":success,...(options.write?{"201":success,"202":{...success,description:"A pending booking resource. Payment-required responses include the hosted checkoutUrl, amount, currency and expiry. No booking confirms before the ordinary signed processor callback and host approval where required."}}:{}),"400":error,"401":error,"403":error,"404":error,"409":error,"410":error,"422":error,"429":{...error,description:"The credential limit was reached. Retry-After states the wait in seconds.",headers:{...responseHeaders,"Retry-After":{schema:{type:"integer",minimum:1}}}},"503":error}};
}
const bookingWrites={write:true,scopes:["bookings:write"]};
const eventWrites={write:true,scopes:["event-types:manage"]};
const routingRead={scopes:["routing:manage"]};
const routingWrites={...routingRead,write:true};
const webhookRead={scopes:["webhooks:manage"]};
const webhookWrites={...webhookRead,write:true};
const availabilityQuery=Object.entries(schema(apiAvailabilityQuerySchema).properties??{}).map(([name,shape])=>({in:"query",name,required:name==="eventTypeId",schema:shape}));

/** The request schemas are the validators used by the HTTP handlers. */
export const openApiDocument={openapi:"3.1.0",info:{title:"Dial public API",version:"1.0.0",description:"Send the owner-issued credential as Authorization: Bearer. Credentials never grant operator documents, archive export, erasure or role changes. Availability and booking mutations retain the ordinary public policies."},servers:[{url:"/api/v1"}],components:{securitySchemes:{bearerAuth:{type:"http",scheme:"bearer"}},schemas:{
 ApiError:{type:"object",required:["error"],properties:{error:{type:"object",required:["code","message"],properties:{code:{type:"string",description:"Stable codes include invalid_credential, credential_expired, credential_revoked, scope_forbidden, not_found, invalid_request, invalid_answers, invalid_pagination, invalid_cursor, idempotency_key_required, idempotency_key_reused, request_in_progress, erased, rate_limited, and the named ordinary booking or routing refusal."},message:{type:"string"},request_id:{type:"string"},details:{type:"array",items:{type:"string"}}}}}},
 CursorPage:{type:"object",required:["data","nextCursor"],properties:{data:{type:"array",items:{type:"object"}},nextCursor:{type:["string","null"]}}},
 WorkflowInput:schema(workflowInput),WorkflowPatch:schema(workflowPatch),
 BookingInput:schema(apiBookingCreateSchema),CancelInput:schema(apiCancellationSchema),RescheduleInput:schema(apiRescheduleSchema),AttendanceInput:schema(apiAttendanceSchema),
 EventTypeCreateInput:schema(eventTypeCreationSchema),EventTypeUpdateInput:schema(eventTypeInputSchema),TeamInput:schema(apiTeamSchema),RoutingFormInput:schema(formSchema),RoutingSubmissionInput:schema(apiRoutingSubmissionSchema),PollInput:schema(pollInput),WebhookSubscriptionInput:schema(apiWebhookSchema),
}},paths:{
 "/openapi.json":{get:operation("Read this API description",{scopes:[]})},
 "/event-types":{get:operation("List event types",{list:true,description:"Requires bookings:read or event-types:manage."}),post:operation("Create an event type",{...eventWrites,input:"EventTypeCreateInput"})},
 "/event-types/{id}":{get:operation("Read an event type",{description:"Requires bookings:read or event-types:manage."}),put:operation("Update an event type",{...eventWrites,input:"EventTypeUpdateInput"}),delete:operation("Delete an event type through its ordinary lifecycle",eventWrites)},
 "/event-types/{id}/disable":{post:operation("Disable an event type",eventWrites)},
 "/event-types/{id}/publish":{post:operation("Publish after ordinary readiness checks",eventWrites)},
 "/availability":{get:operation("Read the public booking slots",{query:availabilityQuery,description:"The eventTypeId, week, inviteeTimezone and optional duration select the same slots as the public booking page."})},
 "/bookings":{get:operation("List bookings",{list:true}),post:operation("Book using the ordinary public claim and side effects",{...bookingWrites,input:"BookingInput",description:"A free booking confirms once. Approval requests return pending_approval; paid or saved-card requests return payment_required with the hosted checkout step. The id can be polled at the booking resource. Prices and tax come from the public selection, never caller overrides. Fee consent must use the current public disclosure version. Only the operator can approve; only a signed processor event can mark a payment complete."})},
 "/bookings/{id}":{get:operation("Read a scoped booking")},
 "/bookings/{id}/cancel":{post:operation("Cancel under the ordinary invitee policy",{...bookingWrites,input:"CancelInput"})},
 "/bookings/{id}/reschedule":{post:operation("Move under ordinary availability and change policies",{...bookingWrites,input:"RescheduleInput"})},
 "/bookings/{id}/attendance":{post:operation("Mark attendance after the booking ends",{...bookingWrites,input:"AttendanceInput"})},
 "/hosts":{get:operation("List hosts",{list:true})},"/teams":{get:operation("List teams",{list:true}),post:operation("Create a team",{...eventWrites,input:"TeamInput"})},
 "/routing-forms":{get:operation("List routing forms",{...routingRead,list:true}),post:operation("Create a routing form",{...routingWrites,input:"RoutingFormInput"})},
 "/routing-submissions":{get:operation("List scoped routing submissions",{...routingRead,list:true}),post:operation("Submit answers through the ordinary routing rules",{...routingWrites,input:"RoutingSubmissionInput",description:"The form and selected destination must be in the credential's host or team scope. The server issues and consumes one routing capability; repeating the key returns the stored submission."})},
 "/polls":{get:operation("List meeting polls",{list:true}),post:operation("Create a meeting poll",{...eventWrites,input:"PollInput"})},
 "/polls/{id}":{get:operation("Read a meeting poll")},"/polls/{id}/close":{post:operation("Close a meeting poll",eventWrites)},
 "/workflows":{get:operation("List granted native workflows",{list:true,scopes:["workflows:manage"]}),post:operation("Create an explicitly enabled or disabled workflow",{write:true,input:"WorkflowInput",scopes:["workflows:manage"],description:"A webhook action also requires webhooks:manage and an authorized subscription for workflow.action.v1. A routing-without-booking trigger additionally requires routing:manage and an owned routingFormId; it acts only on a disqualifying message outcome. It supports a signed webhook or email-hosts to the owning active owner host; routing emails reject booking variables and contain no submitted answers. Other routing actions are refused. Webhook payloads contain native scheduling facts without answers, contact details or manage links. A hubspot-contact-update action uses an owner-authorized crmConnectionId, looks up an existing contact by the booking email and sets only the three documented scheduling properties. Missing contacts are skipped; runs expose outcomes without credentials."})},
 "/workflows/{id}":{get:operation("Read a scoped workflow",{scopes:["workflows:manage"]}),patch:operation("Change workflow settings and invalidate prior queued authority",{write:true,input:"WorkflowPatch",scopes:["workflows:manage"]}),delete:operation("Remove a workflow and stop unsent messages",{write:true,scopes:["workflows:manage"]})},
 "/workflows/{id}/preview":{get:operation("Preview a workflow against a scoped real booking",{scopes:["workflows:manage","bookings:read"],query:[{in:"query",name:"bookingId",required:true,schema:{type:"string"}}],description:"Renders the booking variables without exposing a manage token. Host actions cannot use manage links. Private answer variables and unknown variables are refused."})},
 "/workflows/{id}/runs":{get:operation("Read durable workflow delivery outcomes",{list:true,scopes:["workflows:manage"]})},
 "/webhook-subscriptions":{get:operation("List scoped webhook subscriptions",{...webhookRead,list:true}),post:operation("Create a scoped webhook subscription",{...webhookWrites,input:"WebhookSubscriptionInput",description:"The subscription inherits the credential scope. The signing secret is returned once; a replay returns its id and secretShown: false."})},
 "/webhook-subscriptions/{id}":{delete:operation("Delete a scoped webhook subscription",webhookWrites)},
}};
for(const [path,item] of Object.entries(openApiDocument.paths))if(path.includes("{id}"))Object.assign(item,{parameters:[{in:"path",name:"id",required:true,schema:{type:"string",minLength:26,maxLength:26}}]});
