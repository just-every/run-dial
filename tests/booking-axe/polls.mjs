import assert from 'node:assert/strict';
import { auditor,trackPage } from './audit.mjs';
import { pollEvent,pollLinks } from '../polls/fixture.mjs';
export async function pollScreens(browser,owner,origin,scans,errors){
 const request=async(method,path,data,status=200)=>{const response=await owner.request[method](origin+path,{headers:{Origin:origin},data});assert.equal(response.status(),status,`${method} ${path}: poll door`);return response.json();};
 const data=(path,body,status=200,method=body===undefined?'get':'post')=>request(method,path,body,status);
 const event=await pollEvent(data,'synthetic-dial-1014'),storageState=await owner.storageState(),week=new Date(Date.now()+24*86400000).toISOString().slice(0,10);
 const rows=async()=>(await data('/__fixtures/status')).delivery_outbox;
 for(const width of [1440,390]){
  const host=await browser.newContext({storageState,viewport:{width,height:900},timezoneId:'America/New_York'}),participants=[];
  try{
   const page=await host.newPage();trackPage(page,errors);const audit=auditor(page,width,scans);
   await page.goto(origin+'/app/bookings?view=polls');await page.locator('[data-poll-composer-ready="true"]').waitFor();
   await page.getByLabel('Poll title',{exact:true}).fill('Project planning '+width);
   await page.getByLabel('Event type',{exact:true}).selectOption(event.id);
   await page.getByLabel('Week starting',{exact:true}).fill(week);await page.getByRole('button',{name:'Load live times',exact:true}).click();
   const candidates=page.getByRole('group',{name:/Candidate times/});await candidates.getByRole('checkbox').nth(1).waitFor();
   await candidates.getByRole('checkbox').nth(0).check();await candidates.getByRole('checkbox').nth(1).check();
   const people=Array.from({length:4},(_,index)=>({name:['Alex Rivera','Morgan Lee','Taylor Bell','Jamie Chen'][index],email:`synthetic-dial-${1015+(width===390?4:0)+index}@example.test`}));
   await page.getByLabel('Participants',{exact:true}).fill(people.map(p=>`${p.name} <${p.email}>`).join('\n'));
   await page.getByLabel('Close at (UTC)',{exact:true}).fill(new Date(Date.now()+86400000).toISOString().slice(0,16));
   await page.getByLabel('Hold candidate times until the poll closes',{exact:true}).check();
   await audit('poll-composer');
   const created=page.waitForResponse(r=>r.url().endsWith('/api/app/polls')&&r.request().method()==='POST');
   await page.getByRole('button',{name:'Create poll and invite participants',exact:true}).click();const result=await created;assert.equal(result.status(),201);const {id}=await result.json();
   await page.locator('[data-poll-detail-ready="true"]').waitFor();await audit('poll-host-open');
   const links=pollLinks(await rows(),id);assert.equal(links.length,4);
   const read=await data(`/api/app/polls/${id}`);const publicBase=`/api/public/book/dial-host/${event.slug}`;
   const availability=await data(`${publicBase}/availability?week=${week}`);for(const candidate of read.candidates)assert.ok(!availability.slots.some(s=>s.startAt===candidate.startAt),'held candidate is absent at the public door');
   const operator=await owner.request.post(origin+'/api/app/bookings',{headers:{Origin:origin},data:{idempotencyKey:crypto.randomUUID(),eventTypeId:event.id,startAt:read.candidates[0].startAt,inviteeTimezone:'UTC',name:'Other invitee',email:'synthetic-dial-1023@example.test',answers:{},overrideNoticeAndHorizon:false}});assert.equal(operator.status(),409,'operator creation obeys the same candidate hold');
   for(const [index,person]of people.entries()){
    const context=await browser.newContext({viewport:{width,height:900}});participants.push(context);const participant=await context.newPage();trackPage(participant,errors);const link=links.find(l=>l.email===person.email);
    const document=await participant.goto(`${origin}/poll/${id}?token=${link.token}`);assert.ok(document.headers()['cache-control'].includes('no-store'));assert.equal(document.headers()['referrer-policy'],'no-referrer');await participant.locator('[data-poll-participant-ready="true"]').waitFor();
    assert.equal(await participant.getByText(person.name,{exact:false}).count(),1);for(const other of people.filter(p=>p!==person))assert.ok(!(await participant.locator('body').innerText()).includes(other.name),'participant sees no other identity');
    assert.equal((await context.request.get(`${origin}/api/public/polls/${id}?token=${link.token}`)).status(),200);
    const payload=await (await context.request.get(`${origin}/api/public/polls/${id}?token=${link.token}`)).json();assert.equal(Object.hasOwn(payload,'tally'),false,'tally starts hidden');assert.deepEqual(Object.keys(payload).sort(),['candidates','closesAt','id','name','title','votes']);
    for(const select of await participant.getByLabel('Availability',{exact:true}).all())await select.selectOption(index===1?'if_needed':'yes');
    if(index===0)await auditor(participant,width,scans)('poll-participant');
    await participant.getByRole('button',{name:'Save votes',exact:true}).click();await participant.getByRole('status').filter({hasText:'Your votes are saved'}).waitFor();
    assert.notEqual(new URL(participant.url()).searchParams.get('token'),link.token);
    const replay=await context.request.get(`${origin}/api/public/polls/${id}?token=${link.token}`);assert.equal(replay.status(),404);
    if(index===0){await participant.getByLabel('Availability',{exact:true}).first().selectOption('no');const changed=participant.waitForResponse(r=>r.url().endsWith(`/polls/${id}/votes`)&&r.status()===200);await participant.getByRole('button',{name:'Save votes',exact:true}).click();await changed;}
   }
   const toggled=page.waitForResponse(r=>r.url().endsWith(`/polls/${id}/tally`)&&r.status()===200);await page.getByLabel('Show counts to participants',{exact:true}).check();await toggled;
   const publicPage=participants[0].pages()[0];await publicPage.reload();await publicPage.locator('[data-poll-participant-ready="true"]').waitFor();
   const visible=await (await participants[0].request.get(`${origin}/api/public/polls/${id}?token=${new URL(publicPage.url()).searchParams.get('token')}`)).json();assert.equal(visible.tally.length,2);assert.ok(visible.tally.every(t=>Object.keys(t).sort().join(',')==='candidateId,ifNeeded,no,yes'));
   await auditor(publicPage,width,scans)('poll-tally');
   await page.getByRole('button',{name:'Close poll and release times',exact:true}).click();await page.getByRole('status').filter({hasText:'This poll is closed'}).waitFor();await audit('poll-host-closed');
   const released=await data(`${publicBase}/availability?week=${week}`);for(const candidate of read.candidates)assert.ok(released.slots.some(s=>s.startAt===candidate.startAt),'close returns every held candidate at once');
   for(const context of participants){const participant=context.pages()[0];assert.equal((await context.request.get(`${origin}/api/public/polls/${id}?token=${new URL(participant.url()).searchParams.get('token')}`)).status(),404);}
   assert.deepEqual(await page.locator('button,a[href]').evaluateAll(nodes=>nodes.filter(n=>!n.textContent.trim()).map(n=>n.getAttribute('aria-label'))),[],'poll host uses text controls');
  }finally{for(const context of participants)await context.close();await host.close();}
 }
}
