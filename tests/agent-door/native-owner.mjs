import assert from 'node:assert/strict';
import {calendarFixtureSecret} from './native-calendar.mjs';
export const profile = {handle:'synthetic-dial-owner',name:'Avery Chen',title:'Scheduling coordinator',biography:'Meet with Avery to plan the next project.',timezone:'UTC',focusAreas:[],socialProof:[]};
export const eventInput = (slug='synthetic-dial-meeting') => ({slug,title:'Project planning',description:'Plan the next project together.',durationMinutes:30,color:'#dcab3c',locationType:'fixed_link',locationLabel:'Meeting link',locationValue:'https://meet.example.invalid/planning',listed:true,alternativeRequestsEnabled:true,slotIncrementMinutes:30,minimumNoticeMinutes:0,bookingHorizonDays:60,beforeBufferMinutes:0,afterBufferMinutes:0,hostDayBookingLimit:null,postBookingRedirect:null,questions:[],availability:Array.from({length:7},(_,weekday)=>({weekday,startMinute:0,endMinute:1440}))});
export default async function initialize({request,origin,token,claim,fixtures}) {
 const post=(path,body,headers={})=>request(new URL(path,origin).href,{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const raw=await post(claim.path,{token,displayName:'Avery Chen'}); assert.equal(raw.status,403,'signed endpoint refuses raw setup token');
 const owner=await post(claim.path,{token:claim.token,displayName:'Avery Chen',returnTo:'/app'}); assert.equal(owner.status,303,'signed owner claim opens native session');
 const replay=await post(claim.path,{token:claim.token,displayName:'Avery Chen',returnTo:'/app'}); assert.equal(replay.status,409,'signed claim replay refuses');
 const cookie=owner.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ');
 const headers={Origin:origin,Cookie:cookie,'Content-Type':'application/json'};
 const data=async(path,body,method=body===undefined?'GET':'POST')=>{const response=await request(new URL(path,origin).href,{method,redirect:'manual',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});assert.ok(response.ok,`${method} ${path.split('?')[0]} HTTP ${response.status}${response.ok?'':': '+JSON.stringify(await response.json())}`);return response.status===204?null:response.json();};
 await fixtures.set('https://api.sendgrid.com',{accessToken:token});
 await fixtures.set('https://api.resend.com',{accessToken:token});
 await fixtures.set('https://cloudflare-dns.com',{});
 await fixtures.set('https://synthetic-dial-site.example',{});
 await data('/api/app/profile',profile,'PATCH');
 calendarFixtureSecret(token);
 return owner;
}
