import start from '@tanstack/react-start/server-entry';
import { createWorker } from '../../src/core/app/worker';
import { BookingCoordinator as ProductionCoordinator } from '../../src/core/app/booking-coordinator';
import { createServices } from '../../src/core/app/services';
import { parseRuntimeEnvironment } from '../../src/core/shared/runtime-env';
import { EventTypesRepository } from '../../src/core/features/event-types';
import type { AppBindings } from '../../src/core/app/bindings';
import { fixtureProviders } from '../review/providers';
import { setup, status } from '../review/setup';
const servicesFor=(env:AppBindings)=>createServices(env.DB,parseRuntimeEnvironment(env),{fetch:(r:Request)=>start.fetch(r)} as Fetcher,fixtureProviders(env.DB));
export class BookingCoordinator extends ProductionCoordinator{protected services(env:AppBindings){return servicesFor(env);}}
const production=createWorker(servicesFor);
export default {...production,async fetch(request:Request,env:AppBindings,context:ExecutionContext){
 const url=new URL(request.url);if(url.hostname!=='127.0.0.1')return new Response(null,{status:404});
 if(url.pathname==='/__fixtures/import-empty'&&request.method==='POST'){
  await setup(env,servicesFor(env));await env.DB.batch(['event_types','host_profiles','fixture_activity','fixture_mail'].map(t=>env.DB.prepare(`DELETE FROM ${t}`)));return Response.json({ok:true});
 }
 if(url.pathname==='/__fixtures/import-public'&&request.method==='POST'){
  const events=new EventTypesRepository(env.DB);const event=await events.create({slug:'native-public',title:'Native availability',description:'Public occupancy proof',durationMinutes:30,color:'#176b5a',locationType:'fixed_link',locationLabel:'Meeting',locationValue:'https://meet.example.test/native',listed:true,alternativeRequestsEnabled:true,slotIncrementMinutes:30,minimumNoticeMinutes:0,bookingHorizonDays:365,beforeBufferMinutes:0,afterBufferMinutes:0,hostDayBookingLimit:null,questions:[],availability:Array.from({length:7},(_,weekday)=>({weekday,startMinute:0,endMinute:1440}))});await events.setStatus(event.id,'published');return Response.json({id:event.id});
 }
 if(url.pathname==='/__fixtures/import-public'&&request.method==='DELETE'){await env.DB.prepare("DELETE FROM event_types WHERE slug='native-public'").run();return Response.json({ok:true});}
 if(url.pathname==='/__fixtures/import-edge-reservation'&&request.method==='POST'){
  await env.DB.prepare("INSERT INTO event_types(id,status,slug,title,description,duration_minutes,color,location_type,location_label,created_at,updated_at) VALUES('existing','draft','example-1','Native','',30,'#176b5a','in_person','Here','2027-01-01','2027-01-01')").run();
  await env.DB.prepare("INSERT INTO bookings(id,event_type_id,event_slug,event_title,duration_minutes,location_type,location_label,location_value,invitee_name,invitee_email,host_timezone,invitee_timezone,state,ical_uid,calendar_state,meeting_state,current_occurrence_id,created_at,updated_at) VALUES('native','existing','native','Native',30,'in_person','Here','','Native','native@example.test','America/New_York','America/New_York','confirmed','native@example.test','succeeded','not_required','native-occurrence','2027-01-01','2027-01-01')").run();
  await env.DB.prepare("INSERT INTO booking_occurrences(id,booking_id,sequence,start_at,end_at,occupied_start_at,occupied_end_at,host_date,state,is_current,created_at) VALUES('native-occurrence','native',0,'2027-01-05T15:00:00.000Z','2027-01-05T15:30:00.000Z','2027-01-05T15:00:00.000Z','2027-01-05T15:30:00.000Z','2027-01-05','current',1,'2027-01-01')").run();return Response.json({ok:true});
 }
 if(url.pathname==='/__fixtures/import-status')return Response.json(await status(env.DB));
 return production.fetch(request,env,context);
}};
