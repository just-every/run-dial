import type { AvailabilityService } from "../availability";
import type { BookingLinksService } from "../booking-links";
import { foldEmail } from "../erasure";
import { PollsRepository } from "./repository";
import type { PollInput, Vote } from "./types";
export class PollsService {
 readonly repository:PollsRepository;
 constructor(private readonly db:D1Database, secret:string,origin:string,private readonly availability:AvailabilityService,private readonly links:BookingLinksService){this.repository=new PollsRepository(db,secret,origin);}
 async create(input:PollInput){
  input={...input,closesAt:new Date(input.closesAt).toISOString(),starts:input.starts.map(s=>new Date(s).toISOString())};
  if(input.closesAt<=new Date().toISOString()||new Set(input.starts).size!==input.starts.length||new Set(input.participants.map(p=>foldEmail(p.email))).size!==input.participants.length)return null;
  const slots=[];
  for(const start of input.starts){const check=await this.availability.verifyOperatorSelection(input.eventTypeId,start,{overrideNoticeAndHorizon:false});if(check.kind!=="valid"||check.event.status!=="published")return null;
   const paid=await this.db.prepare("SELECT 1 FROM event_type_prices WHERE event_type_id=? UNION SELECT 1 FROM event_type_payment_terms WHERE event_type_id=? LIMIT 1").bind(input.eventTypeId,input.eventTypeId).first();
   if(paid||(await this.db.prepare("SELECT 1 FROM event_types WHERE id=? AND approval_required=1").bind(input.eventTypeId).first()))return null;
   slots.push({startAt:start,endAt:check.slot.endAt,occupiedStartAt:new Date(Date.parse(start)-check.event.beforeBufferMinutes*60000).toISOString(),occupiedEndAt:new Date(Date.parse(check.slot.endAt)+check.event.afterBufferMinutes*60000).toISOString()});
  }
  if(input.closesAt>=slots[0].startAt||slots.some(s=>s.startAt<=input.closesAt))return null;
  let holdLinkId:string|null=null;
  if(input.hold){const held=await this.links.create({eventTypeId:input.eventTypeId,kind:"single_use",expiresAt:input.closesAt,holdHours:Math.ceil((Date.parse(input.closesAt)-Date.now())/3600000)},slots);if(held.kind!=="created")return null;holdLinkId=held.id;}
  try{return await this.repository.create(input,slots,holdLinkId);}catch(error){if(holdLinkId)await this.links.revoke(holdLinkId);throw error;}
 }
 async host(id:string){const poll=await this.repository.get(id);if(!poll)return null;const people=await this.repository.participants(id);return {...poll,candidates:await this.repository.candidates(id),participants:await Promise.all(people.map(async p=>({...p,votes:await this.repository.votes(p.id)})))};}
 async read(id:string,token:string){const poll=await this.repository.get(id),person=await this.repository.participant(id,token);if(!poll||!person)return null;return {id:poll.id,title:poll.title,closesAt:poll.closesAt,name:person.name,candidates:await this.repository.candidates(id),votes:await this.repository.votes(person.id),...(poll.showTally?{tally:await this.repository.tally(id)}:{})};}
 async vote(id:string,token:string,votes:Vote[]){const poll=await this.repository.get(id),person=await this.repository.participant(id,token);if(!poll||!person)return null;
  const candidates=await this.repository.candidates(id);if(votes.length!==candidates.length||new Set(votes.map(v=>v.candidateId)).size!==votes.length||votes.some(v=>!candidates.some(c=>c.id===v.candidateId)))return null;
  for(const candidate of candidates){const check=await this.availability.verifyOperatorSelection(poll.eventTypeId,candidate.startAt,{overrideNoticeAndHorizon:false},new Date(),undefined,undefined,undefined,poll.holdLinkId??undefined);if(check.kind!=="valid")return null;}
  try{return await this.repository.vote(poll,person,token,votes);}catch(error){if(error instanceof Error && /integer overflow/.test(error.message))return null;throw error;}
 }
}
