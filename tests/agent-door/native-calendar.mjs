import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Only this disposable run's binding fixture is retained; no application state
// or production credential is read. The initializer and phase hooks share it.
let secret;
export function calendarFixtureSecret(value) { secret=value; }
export async function connectCalendar({request,origin,email,cookie,fixtures,data}) {
 const token=secret;
 assert.ok(token,'owner initializer must configure its per-run calendar edge');
 const headers={Origin:origin,Cookie:cookie,'Content-Type':'application/json'};
 const auth=await request(new URL('/api/app/calendar/oauth/start',origin).href,{headers,redirect:'manual'}); assert.equal(auth.status,302);
 const authorize=new URL(auth.headers.get('location')), code=randomUUID(), accessToken=randomUUID(), refreshToken=randomUUID();
 const microsoft=authorize.origin==='https://login.microsoftonline.com';
 await fixtures.set(microsoft?'https://login.microsoftonline.com':'https://oauth2.googleapis.com',{clientId:authorize.searchParams.get('client_id'),secret:token,code,redirectUri:new URL('/api/calendar/oauth/callback',origin).href,accessToken,refreshToken});
 await fixtures.set(microsoft?'https://graph.microsoft.com':'https://www.googleapis.com',{accessToken,origin,webhookSecret:token,ownerEmail:email});
 const callback=await request(new URL(`/api/calendar/oauth/callback?state=${encodeURIComponent(authorize.searchParams.get('state'))}&code=${code}`,origin).href,{headers,redirect:'manual'});assert.equal(callback.status,302,'native OAuth callback accepts exact session-bound state');
 await data('/api/app/calendar/selection',{destinationCalendarId:'synthetic-dial-calendar',conflictCalendarIds:['synthetic-dial-calendar']},'PUT');
 await data('/api/app/calendar/check',{});
}
