// Isolated, test-only paid/network boundary. Every credential is per-run fixture data.
const json = (body, status = 200) => Response.json(body, {status});
export default {async fetch(request, {fixture} = {}) {
 const url = new URL(request.url), f = fixture;
 if (!f || !['GET','POST','DELETE'].includes(request.method)) return json({error:'undeclared_fixture'}, 403);
 if (url.origin === 'https://oauth2.googleapis.com') {
  if (url.pathname !== '/token' || request.method !== 'POST' || !request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return json({error:'invalid_request'},400);
  const body = new URLSearchParams(await request.text());
  if (body.get('client_id') !== f.clientId || body.get('client_secret') !== f.secret || body.get('grant_type') !== 'authorization_code' || body.get('code') !== f.code || body.get('redirect_uri') !== f.redirectUri) return json({error:'invalid_grant'},400);
  return json({access_token:f.accessToken,refresh_token:f.refreshToken,expires_in:3600,token_type:'Bearer'});
 }
 if (url.origin === 'https://cloudflare-dns.com' && request.method === 'GET' && url.pathname === '/dns-query' && url.searchParams.get('name') === 'synthetic-dial-site.example' && ['A','AAAA'].includes(url.searchParams.get('type'))) return json({Status:0,Answer:url.searchParams.get('type') === 'A' ? [{name:'synthetic-dial-site.example',type:1,TTL:60,data:'8.8.8.8'}] : []});
 if (url.origin === 'https://synthetic-dial-site.example' && request.method === 'GET') return url.pathname === '/' ? new Response('<!doctype html><html><head><title>Avery Planning</title><meta name="theme-color" content="#174b37"></head><body style="background-color:#f7f4ed;color:#142f26"><h1>Project planning</h1></body></html>',{headers:{'Content-Type':'text/html'}}) : new Response('Not found',{status:404});
 if (request.headers.get('authorization') !== `Bearer ${f.accessToken}`) return json({error:'unauthorized'},401);
 if (url.origin === 'https://api.sendgrid.com') {
  if (request.method === 'GET' && url.pathname === '/v3/verified_senders') return json({results:[{id:1,from_email:'noreply@dial.test',verified:true}]});
  if (request.method === 'GET' && url.pathname === '/v3/whitelabel/domains') return json([]);
  if (request.method === 'POST' && url.pathname === '/v3/mail/send') {
   const body=await request.json();
   if (!body.from?.email || !Array.isArray(body.personalizations) || !body.personalizations.every(p=>Array.isArray(p.to)&&p.to.every(to=>typeof to.email==='string')) || !Array.isArray(body.content)) return json({error:'invalid_payload'},400);
   return new Response(null,{status:202,headers:{'x-message-id':crypto.randomUUID()}});
  }
 }
 if (url.origin === 'https://www.googleapis.com') {
  const calendar={id:'synthetic-dial-calendar',accessRole:'owner',primary:true,conferenceProperties:{allowedConferenceSolutionTypes:['hangoutsMeet']}};
  if (request.method === 'GET' && url.pathname === '/calendar/v3/users/me/calendarList') return json({items:[calendar]});
  if (request.method === 'GET' && url.pathname === `/calendar/v3/users/me/calendarList/${calendar.id}`) return json(calendar);
  if (request.method === 'POST' && url.pathname === '/calendar/v3/freeBusy') {
   const body=await request.json();
   if (!Number.isFinite(Date.parse(body.timeMin)) || !Number.isFinite(Date.parse(body.timeMax)) || Date.parse(body.timeMax)<=Date.parse(body.timeMin) || !body.items?.every(item=>item.id===calendar.id)) return json({error:'invalid_payload'},400);
   return json({kind:'calendar#freeBusy',timeMin:body.timeMin,timeMax:body.timeMax,calendars:{[calendar.id]:{busy:[]}}});
  }
  if (request.method === 'POST' && url.pathname === `/calendar/v3/calendars/${calendar.id}/events/watch`) {
   const body=await request.json();
   if (!body.id || body.type!=='web_hook' || new URL(body.address).origin!==f.origin || body.token!==f.webhookSecret) return json({error:'invalid_watch'},400);
   return json({id:body.id,resourceId:crypto.randomUUID(),expiration:String(Date.now()+7*86400000)});
  }
  if (request.method === 'GET' && url.pathname === `/calendar/v3/calendars/${calendar.id}/events`) return json({items:[],nextSyncToken:crypto.randomUUID()});
 }
 return json({error:'undeclared_provider_request'},502);
}};
