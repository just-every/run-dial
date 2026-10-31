import { PollReminders } from "./reminders";
import { renderBrandedMail } from "../delivery/mail";
import { createId, nowIso } from "../../shared/ids";
import { createOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { foldEmail } from "../erasure";
import type { Candidate, Participant, Poll, PollInput, Vote } from "./types";
const pollFields="id,event_type_id AS eventTypeId,title,closes_at AS closesAt,state,show_tally AS showTally,hold_link_id AS holdLinkId,reminder_offsets_json AS reminderOffsetsJson";
export class PollsRepository {
 readonly reminders: PollReminders;
 constructor(private readonly db:D1Database, private readonly secret:string,private readonly origin:string){this.reminders=new PollReminders(db,secret,origin);}
 private view(row:Omit<Poll,"reminderOffsetsMinutes"> & {reminderOffsetsJson:string}):Poll {const {reminderOffsetsJson,...poll}=row;return {...poll,reminderOffsetsMinutes:JSON.parse(reminderOffsetsJson) as number[]};}
 async list(){return (await this.db.prepare(`SELECT ${pollFields} FROM meeting_polls ORDER BY created_at DESC,id DESC LIMIT 100`).all<Omit<Poll,"reminderOffsetsMinutes"> & {reminderOffsetsJson:string}>()).results.map(row=>this.view(row));}
 async get(id:string){const row=await this.db.prepare(`SELECT ${pollFields} FROM meeting_polls WHERE id=?`).bind(id).first<Omit<Poll,"reminderOffsetsMinutes"> & {reminderOffsetsJson:string}>();return row?this.view(row):null;}
 async candidates(id:string){return (await this.db.prepare("SELECT id,start_at AS startAt,end_at AS endAt FROM poll_candidates WHERE poll_id=? ORDER BY start_at,id").bind(id).all<Candidate>()).results;}
 async participants(id:string){return (await this.db.prepare("SELECT id,name,email,revision FROM poll_participants WHERE poll_id=? ORDER BY created_at,id").bind(id).all<Participant>()).results;}
 async votes(id:string){return (await this.db.prepare("SELECT candidate_id AS candidateId,choice FROM poll_votes WHERE participant_id=? ORDER BY candidate_id").bind(id).all<Vote>()).results;}
 async create(input:PollInput, slots:Array<{startAt:string;endAt:string}>,holdLinkId:string|null){
  const id=createId(),now=nowIso();const statements=[this.db.prepare("INSERT INTO meeting_polls(id,event_type_id,title,closes_at,show_tally,hold_link_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(id,input.eventTypeId,input.title,input.closesAt,input.showTally?1:0,holdLinkId,now,now)];
  for(const slot of slots)statements.push(this.db.prepare("INSERT INTO poll_candidates(id,poll_id,start_at,end_at,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(createId(),id,slot.startAt,slot.endAt,now,now));
  for(const person of input.participants){const participantId=createId(),token=createOpaqueToken();
   statements.push(this.db.prepare("INSERT INTO poll_participants(id,poll_id,name,email,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(participantId,id,person.name,foldEmail(person.email),now,now),this.db.prepare("INSERT INTO poll_vote_tokens(participant_id,token_hash,created_at,updated_at) VALUES(?,?,?,?)").bind(participantId,await hashToken(token,this.secret),now,now));
   const url=new URL(`/poll/${id}`,this.origin);url.searchParams.set("token",token);const text=`${input.title}\nChoose your availability: ${url.href}\nThis personal link expires when the poll closes.`;
   const payload={to:foldEmail(person.email),subject:`Meeting poll: ${input.title}`,text,html:renderBrandedMail({businessName:"Dial",heading:input.title,intro:"Choose your availability before this poll closes.",facts:[{label:"Your personal poll link",value:url.href}]}),pollParticipantId:participantId};
   statements.push(this.db.prepare("INSERT INTO delivery_outbox(id,kind,idempotency_key,payload_json,state,attempts,next_attempt_at,created_at,updated_at) VALUES(?,'mail_send',?,?,'pending',0,?,?,?)").bind(createId(),`poll-invitation:${participantId}`,JSON.stringify(payload),now,now,now));}
  await this.db.batch(statements);return {id};
 }
 async participant(pollId:string,token:string){if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
  return this.db.prepare("SELECT p.id,p.name,p.email,p.revision FROM poll_participants p JOIN poll_vote_tokens t ON t.participant_id=p.id JOIN meeting_polls m ON m.id=p.poll_id WHERE p.poll_id=? AND t.token_hash=? AND m.state='open' AND m.closes_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=p.email)").bind(pollId,await hashToken(token,this.secret)).first<Participant>();
 }
 async vote(poll:Poll,person:Participant,token:string,votes:Vote[]){
  const next=createOpaqueToken(), now=nowIso(),hash=await hashToken(token,this.secret),nextHash=await hashToken(next,this.secret);
  // Losing a capability compare-and-swap aborts the entire batch, including every vote.
  await this.db.batch([
   this.db.prepare("UPDATE poll_vote_tokens SET token_hash=?,updated_at=? WHERE participant_id=? AND token_hash=? AND EXISTS(SELECT 1 FROM meeting_polls WHERE id=? AND state='open' AND closes_at>?) AND EXISTS(SELECT 1 FROM poll_participants WHERE id=? AND revision=?)").bind(nextHash,now,person.id,hash,poll.id,now,person.id,person.revision),
   this.db.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END"),
   this.db.prepare("DELETE FROM poll_votes WHERE participant_id=?").bind(person.id),
   ...votes.map(v=>this.db.prepare("INSERT INTO poll_votes(participant_id,candidate_id,choice,created_at,updated_at) VALUES(?,?,?,?,?)").bind(person.id,v.candidateId,v.choice,now,now)),
   this.db.prepare("UPDATE poll_participants SET revision=revision+1,updated_at=? WHERE id=?").bind(now,person.id),
  ]);return next;
 }
 async settings(id:string,show:boolean){return this.db.prepare("UPDATE meeting_polls SET show_tally=?,updated_at=? WHERE id=? RETURNING id").bind(show?1:0,nowIso(),id).first();}
 async close(id:string){const now=nowIso();await this.db.batch([this.db.prepare("UPDATE delivery_outbox SET state='failed',last_error_code='poll_closed',updated_at=? WHERE state='pending' AND json_extract(payload_json,'$.pollParticipantId') IN(SELECT id FROM poll_participants WHERE poll_id=?)").bind(now,id),this.db.prepare("UPDATE booking_links SET revoked_at=?,updated_at=? WHERE id=(SELECT hold_link_id FROM meeting_polls WHERE id=?)").bind(now,now,id),this.db.prepare("UPDATE meeting_polls SET state='closed',updated_at=? WHERE id=?").bind(now,id)]);}
 async tally(id:string){return (await this.db.prepare("SELECT c.id AS candidateId,sum(CASE WHEN v.choice='yes' THEN 1 ELSE 0 END) AS yes,sum(CASE WHEN v.choice='if_needed' THEN 1 ELSE 0 END) AS ifNeeded,sum(CASE WHEN v.choice='no' THEN 1 ELSE 0 END) AS no FROM poll_candidates c LEFT JOIN poll_votes v ON v.candidate_id=c.id WHERE c.poll_id=? GROUP BY c.id ORDER BY c.start_at,c.id").bind(id).all<{candidateId:string;yes:number;ifNeeded:number;no:number}>()).results;}
}
