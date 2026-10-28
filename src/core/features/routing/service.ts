import type { ClickIds } from "../analytics";
import type { EventTypesService } from "../event-types";
import type { HostProfileService } from "../host-profile";
import { cleanAttribution, type BookingAttribution } from "../bookings";
import { resolveRoutingPeriod, type RoutingReportPeriod } from "./report";
import { RoutingRepository } from "./repository";
import { validateRoutingAnswers } from "./validation.mjs";
import { matchRoute } from "./rules";
import type { RoutingAnswers, RoutingFormInput } from "./types";

export class RoutingService {
 readonly repository:RoutingRepository;
 constructor(db:D1Database,secret:string,private readonly origin:string,private readonly events:EventTypesService,private readonly profiles:HostProfileService){this.repository=new RoutingRepository(db,secret);}
 async save(input:RoutingFormInput,id?:string) {
  for(const outcome of [...input.rules.map(rule=>rule.outcome),input.fallback])if(outcome.kind==="event"&&!await this.events.getEventType(outcome.eventTypeId))return undefined;
  return this.repository.save(input,id);
 }
 async read(slug:string){const form=await this.repository.publicForm(slug);if(!form)return undefined;return {form:{title:form.title,questions:form.questions},...await this.repository.issue(form.id)};}
 async preview(id:string,answers:RoutingAnswers){const form=await this.repository.get(id);if(!form)return undefined;const validated=validateRoutingAnswers(form.questions,answers);return validated.ok?{ok:true as const,...matchRoute(form,validated.answers)}:validated;}
 async submit(slug:string,token:string,input:RoutingAnswers,attribution:BookingAttribution={},clickIds:ClickIds={}) {
  const form=await this.repository.publicForm(slug);if(!form)return {kind:"unavailable" as const};
  const capability=await this.repository.token(form.id,token);if(!capability)return {kind:"unavailable" as const};
  const checked=validateRoutingAnswers(form.questions,input);if(!checked.ok)return {kind:"invalid" as const,fields:checked.fields};
  const route=matchRoute(form,checked.answers),outcome=route.outcome;
  const target=outcome.kind==="event"?await this.events.getEventType(outcome.eventTypeId):undefined;
  const profile=outcome.kind==="event"?await this.profiles.getProfile():undefined;
  if(outcome.kind==="event"&&(!target||target.status!=="published"||!profile))return {kind:"unavailable" as const};
  const source=cleanAttribution({...Object.fromEntries(form.questions.filter(q=>q.kind==="hidden"&&["utm_source","utm_medium","utm_campaign","utm_term","utm_content","source"].includes(q.parameter??q.key)).flatMap(q=>typeof checked.answers[q.key]==="string"?[[q.parameter??q.key,checked.answers[q.key]]]:[])),...attribution});
  const submitted=await this.repository.submit(form,capability.id,checked.answers,source,route);if(!submitted)return {kind:"unavailable" as const};
  if(outcome.kind!=="event")return {...outcome,submissionReference:submitted.id};
  const url=new URL(`/book/${profile!.handle}/${target!.slug}`,this.origin);url.searchParams.set("routeToken",submitted.handoff);
  for(const [key,value] of Object.entries(clickIds))if(value)url.searchParams.set(key,value);
  for(const question of form.questions){
   const value=checked.answers[question.key];if(value===undefined||question.private)continue;
   if((question.kind==="email"||question.key==="name")&&typeof value==="string")url.searchParams.set(question.kind==="email"?"email":"name",value);
   for(const part of Array.isArray(value)?value:[value])url.searchParams.append(`answer.${question.key}`,part);
  }
  for(const [key,value] of Object.entries(source))if(value)url.searchParams.set(key,value);
  return {kind:"event" as const,url:url.toString(),submissionReference:submitted.id};
 }
 async detail(id:string,period:RoutingReportPeriod={}) {
  const form=await this.repository.get(id);if(!form)return undefined;
  const resolved=await resolveRoutingPeriod(this.profiles,period);if(resolved.kind!=="resolved")return resolved;
  const submissions=await this.repository.submissions(id,resolved.filter),groups=new Map<string,{ruleId:string|null;ruleLabel:string;source:string;submissions:number;bookings:number;conversion:number;submissionIds:string[];bookingIds:string[]}>();
  for(const row of submissions){const source=row.attribution.utm_source??row.attribution.source??"Direct",key=JSON.stringify([row.ruleId,source]);
   const group=groups.get(key)??{ruleId:row.ruleId,ruleLabel:row.ruleLabel,source,submissions:0,bookings:0,conversion:0,submissionIds:[],bookingIds:[]};
   group.submissions++;group.submissionIds.push(row.id);if(row.bookingId){group.bookings++;group.bookingIds.push(row.bookingId);}group.conversion=group.bookings/group.submissions;groups.set(key,group);
  }
  return {form,submissions,report:{period:resolved.period,definition:"The cohort counts accepted submissions created within the selected host dates, filtered by the event selected when each submission was accepted. Bookings count cohort submissions with a committed booking, including bookings committed after the period. Conversion is cohort bookings divided by cohort submissions, grouped by matched route and UTM source (or custom source, then Direct).",groups:[...groups.values()]}};
 }
}
