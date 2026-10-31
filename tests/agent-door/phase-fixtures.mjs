import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {profile,eventInput} from './native-owner.mjs';
import {connectCalendar} from './native-calendar.mjs';

let round=0;
export default async function prepare(context) {
 const {request,origin,cookie}=context;
 const index=round++;
 const headers={Origin:origin,Cookie:cookie,'Content-Type':'application/json','CF-Connecting-IP':`192.0.2.${index+1}`};
 const clientTarget=`synthetic-dial-${index*4+1}@example.invalid`,clientSource=`synthetic-dial-${index*4+2}@example.invalid`;
 const data=async(path,body,method=body===undefined?'GET':'POST')=>{const response=await request(new URL(path,origin).href,{method,redirect:'manual',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});assert.ok(response.ok,`Native phase fixture ${method} ${path.split('?')[0]} HTTP ${response.status}`);return response.status===204?null:response.json();};
 await data('/api/app/profile',profile,'PATCH');
 await connectCalendar({...context,data});
 for (const existing of await data('/api/app/event-types')) if(existing.status==='published') await data(`/api/app/event-types/${existing.id}/disable`,{});
 const event=await data('/api/app/event-types',eventInput('synthetic-dial-'+randomUUID()));
 await data(`/api/app/event-types/${event.id}/publish`,{});
 // A person creates native fixture work; no agent admission or delayed agent effect is invented.
 const date=new Date(Date.now()+(3+index)*86400000);date.setUTCHours(12,0,0,0);
 const selection={startAt:date.toISOString(),inviteeTimezone:'UTC'};
 const selected=await data(`/api/public/book/${profile.handle}/${event.slug}/selection`,selection);
 await data(`/api/public/book/${profile.handle}/${event.slug}/confirm`,{...selection,nonce:selected.nonce,name:'Jordan Rivera',email:clientTarget,answers:{}});
 const later=new Date(date.getTime()+3600000).toISOString();
 const selected2=await data(`/api/public/book/${profile.handle}/${event.slug}/selection`,{...selection,startAt:later});
 await data(`/api/public/book/${profile.handle}/${event.slug}/confirm`,{...selection,startAt:later,nonce:selected2.nonce,name:'Morgan Ellis',email:clientSource,answers:{}});
 const link=await data('/api/app/booking-links',{eventTypeId:event.id,kind:'single_use',expiresAt:new Date(Date.now()+86400000).toISOString(),offeredStarts:[new Date(date.getTime()+7200000).toISOString()],holdHours:12});
 const poll=await data('/api/app/polls',{eventTypeId:event.id,title:'Planning alternatives',participants:[{name:'Sam Patel',email:'synthetic-dial-3@example.invalid'}],starts:[new Date(date.getTime()+10800000).toISOString(),new Date(date.getTime()+14400000).toISOString()],closesAt:new Date(Date.now()+86400000).toISOString(),hold:true,showTally:false});
 const requestBody={inviteeName:'Taylor Brooks',inviteeEmail:'synthetic-dial-4@example.invalid',inviteeTimezone:'UTC',note:'Please find another time.',windows:[{date:date.toISOString().slice(0,10),startMinute:1020,endMinute:1080}]};
 const review=await data(`/api/public/events/${profile.handle}/${event.slug}/request/review`,requestBody);
 await data(`/api/public/events/${profile.handle}/${event.slug}/request?nonce=${encodeURIComponent(review.nonce)}`,requestBody);
 return {values:{nativeEvent:event,link,poll,clientTarget,clientSource,agentSlug:'synthetic-dial-agent-'+randomUUID()}};
}
