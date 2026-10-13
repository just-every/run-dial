import type { EventTypesService } from '../event-types';
import type { HostProfileService } from '../host-profile';
import { bookingUrl, validHostProfile } from '../host-setup';
import { readinessFix } from '../event-types';
import { hostDate } from './model';
import { describeDifferences } from './difference-report';
import type { SourceDifference } from './differences';

type Row='eventTypes'|'bookings'|'differences'|'providers';

/** The switch-over checklist, read from live data. Dial never contacts the source
 * scheduler: every row states what Dial holds and what still belongs to the source. */
export class SwitchOverService{
 constructor(private readonly db:D1Database,private readonly events:EventTypesService,private readonly profiles:HostProfileService,private readonly publicOrigin:string){}
 async read(now=new Date()){
  const imported=new Set((await this.db.prepare("SELECT id FROM move_in_targets WHERE kind='event'").all<{id:string}>()).results.map(row=>row.id));
  const capture=await this.db.prepare('SELECT mode,captured_at AS capturedAt,as_of AS asOf FROM move_in_captures ORDER BY COALESCE(captured_at,as_of) DESC,rowid DESC LIMIT 1').first<{mode:string;capturedAt:string|null;asOf:string}>();
  // Nothing imported: no checklist, and no provider check on its behalf.
  if(!imported.size&&!capture&&!await this.db.prepare("SELECT 1 FROM move_in_targets LIMIT 1").first())return {imported:false as const};
  const [profile,all,providers]=await Promise.all([this.profiles.getProfile(),this.events.listEventTypes(),this.events.providerReadiness()]);
  const zone=profile?.timezone??'UTC';
  const links=new Map((await this.db.prepare('SELECT event_type_id AS id,source_url AS url FROM move_in_source_links').all<{id:string;url:string}>()).results.map(row=>[row.id,row.url]));
  const eventTypes=await Promise.all(all.filter(event=>imported.has(event.id)).map(async event=>{
   const readiness=event.status==='published'?{ready:true,missing:[]}:await this.events.eventReadiness(event,providers);
   return {id:event.id,title:event.title,oldLink:links.get(event.id)??null,dialLink:validHostProfile(profile)?bookingUrl(this.publicOrigin,profile!,event):null,
    status:event.status==='published'?'published' as const:readiness.ready?'draft' as const:'blocked' as const,reasons:readiness.missing.map(code=>({code,...readinessFix(code,event.id)}))};
  }));
  const bookings=await this.db.prepare(`SELECT count(CASE WHEN o.end_at>? THEN 1 END) AS future,max(o.end_at) AS lastEndAt
   FROM bookings b JOIN booking_occurrences o ON o.id=b.current_occurrence_id WHERE b.imported=1 AND b.state IN ('confirmed','rescheduled')`).bind(now.toISOString()).first<{future:number;lastEndAt:string|null}>();
  const future=bookings?.future??0,lastEndAt=bookings?.lastEndAt??null;
  // The day after the last imported booking ends, in the host's zone.
  const closableOn=future&&lastEndAt?hostDate(new Date(Date.parse(`${hostDate(lastEndAt,zone)}T12:00:00Z`)+86_400_000).toISOString(),'UTC'):null;
  const latest=await this.db.prepare("SELECT job_id AS jobId,captured_at AS capturedAt,as_of AS asOf FROM move_in_captures WHERE mode='catch_up' ORDER BY recorded_at DESC,rowid DESC LIMIT 1").first<{jobId:string;capturedAt:string|null;asOf:string}>();
  const differences=latest?await describeDifferences(this.db,(await this.db.prepare('SELECT booking_id AS bookingId,kind,source_start_at AS sourceStartAt,source_end_at AS sourceEndAt,decision FROM move_in_differences WHERE job_id=? ORDER BY rowid').bind(latest.jobId).all<SourceDifference&{decision:'kept'|'released'|null}>()).results):[];
  const calendar=providers?.calendar.kind==='healthy',mail=providers?.mail.kind==='healthy';
  const rows={
   eventTypes:eventTypes.every(event=>event.status==='published'),
   bookings:future===0,
   differences:differences.every(item=>item.resolved),
   providers:calendar&&mail,
  } satisfies Record<Row,boolean>;
  return {
   imported:true as const,hostZone:zone,eventTypes,
   bookings:{future,lastEndAt,closableOn},
   differences:{latestCatchUp:latest?{capturedAt:latest.capturedAt,asOf:latest.asOf}:null,unresolved:differences.filter(item=>!item.resolved).length,total:differences.length},
   providers:{calendar:calendar?null:readinessFix('destination_calendar'),mail:mail?null:readinessFix('transactional_mail')},
   lastCapture:capture?{capturedAt:capture.capturedAt,asOf:capture.asOf,ageDays:Math.max(0,Math.floor((now.getTime()-Date.parse(capture.capturedAt??capture.asOf))/86_400_000))}:null,
   open:(Object.keys(rows) as Row[]).filter(row=>!rows[row]),
  };
 }
}

/** The old and new links, for the owner's site, signatures and templates. Cells stay inert in spreadsheets. */
export type SwitchOverState=Extract<Awaited<ReturnType<SwitchOverService['read']>>,{imported:true}>;
export function linksCsv(eventTypes:SwitchOverState['eventTypes']){
 const cell=(value:string)=>{const inert=/^[=+\-@\t\r]/u.test(value)?`'${value}`:value;return `"${inert.replaceAll('"','""')}"`;};
 return ['Event type,Old link,Dial link,Status,Publication reason',...eventTypes.map(event=>[event.title,event.oldLink??'',event.dialLink??'',event.status,event.reasons.map(reason=>reason.label).join(' ')].map(cell).join(','))].join('\r\n')+'\r\n';
}
