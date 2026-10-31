import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { auditor, trackPage } from './audit.mjs';
import { rememberedClientJourney } from './remembered-client.mjs';

export async function clientRecordsJourney(browser, owner, origin, fixture, scans, errors) {
  const headers={Origin:origin};
  const request=async(method,path,data,expected=200)=>{
    const response=await owner.request[method](origin+path,{headers,data});
    assert.equal(response.status(),expected,`${method} ${path}: client door refused`);
    return response.json();
  };
  const event=await request('get',`/api/app/event-types/${fixture.eventId}`);
  const profile=await request('get','/api/app/profile');
  const week=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
  const storageState=await owner.storageState();
  for(const [index,width] of [1440,390].entries()) {
    const email=`synthetic-dial-${1004+index*2}@example.test`,target=`synthetic-dial-${1005+index*2}@example.test`;
    const bookings=[];
    for(const [person,count] of [[email,3],[target,1]])for(let i=0;i<count;i++){
      const available=await request('get',`/api/public/book/dial-host/intro/availability?week=${week}`);
      const booking=await request('post','/api/app/bookings',{idempotencyKey:randomUUID(),eventTypeId:fixture.eventId,startAt:available.slots[0].startAt,inviteeTimezone:'America/New_York',name:'Alex Rivera',email:person,answers:Object.fromEntries(event.questions.map(question=>[question.key,'Discuss the next project milestone.'])),overrideNoticeAndHorizon:false},201);
      if(person===email)bookings.push(booking);
    }
    const context=await browser.newContext({storageState,viewport:{width,height:900},timezoneId:'America/New_York'});
    try {
      const page=await context.newPage();trackPage(page,errors);const audit=auditor(page,width,scans);
      await page.goto(origin+'/app/bookings');
      await page.locator('[data-operator-ready="true"]').waitFor();
      await page.getByRole('link',{name:'Clients',exact:true}).click();
      await page.getByRole('button',{name:new RegExp(email.replaceAll('.','\\.'))}).click();
      await page.locator('[data-clients-ready="true"]').waitFor();
      await page.locator('[data-client-booking]').first().waitFor();
      assert.equal(await page.locator('[data-client-booking]').count(),3);
      assert.deepEqual(await page.locator('[data-client-booking]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-client-booking')).sort()),bookings.map(booking=>booking.id).sort());
      await page.getByText(new RegExp(`Times in ${profile.timezone.replaceAll('/','\\/')}`)).waitFor();
      await page.getByRole('button',{name:'Add note, field or merge',exact:true}).click();
      await page.getByLabel('New client note',{exact:true}).fill(`Prepare the proposal together at ${width}.`);
      await page.getByRole('button',{name:'Add note',exact:true}).click();
      await page.getByText(`Prepare the proposal together at ${width}.`,{exact:true}).waitFor();
      await page.locator('[data-client-annotations-ready="true"]').waitFor();
      await page.getByLabel('Custom field name',{exact:true}).fill('Relationship reference');
      await page.getByLabel('Custom field value',{exact:true}).fill(`CLIENT-${width}`);
      const savedField=page.waitForResponse(response=>response.url().endsWith('/api/app/clients/fields')&&response.request().method()==='POST');
      await page.getByRole('button',{name:'Add client field',exact:true}).click();
      assert.equal((await savedField).status(),201);
      await page.getByText(`CLIENT-${width}`,{exact:true}).waitFor();
      await audit('clients-history');
      await page.locator(`[data-client-booking="${bookings[0].id}"]`).getByRole('link',{name:'Open booking record',exact:true}).click();
      const record=page.getByRole('region',{name:'Selected client booking'});
      await record.getByRole('heading',{name:'Alex Rivera',exact:true}).waitFor();
      assert.ok(new URL(page.url()).searchParams.get('record')===bookings[0].id);
      await audit('clients-booking-record');
      await page.getByRole('button',{name:'Close booking record',exact:true}).click();
      await page.getByLabel('Merge this client into',{exact:true}).fill(target);
      page.once('dialog',async dialog=>{assert.equal(dialog.type(),'confirm');await dialog.accept();});
      await page.getByRole('button',{name:'Merge clients',exact:true}).click();
      await page.waitForURL(url=>new URL(url).searchParams.get('client')===target);
      await page.locator('[data-clients-ready="true"]').waitFor();
      assert.equal(await page.locator('[data-client-booking]').count(),4);
      await page.getByText(`Prepare the proposal together at ${width}.`,{exact:true}).waitFor();
      await page.getByText(`CLIENT-${width}`,{exact:true}).waitFor();
      await audit('clients-merged');
      await page.reload();await page.locator('[data-clients-ready="true"]').waitFor();
      assert.equal(await page.locator('[data-client-booking]').count(),4,'merged client reload retains every booking');
      const iconOnly=await page.locator('button,a[href]').evaluateAll(nodes=>nodes.filter(node=>!node.textContent.trim()).map(node=>node.getAttribute('aria-label')));
      assert.deepEqual(iconOnly,[],'Clients uses visible text for every control');
      await rememberedClientJourney({page,context,owner,origin,email,event,audit});
      console.log(`CLIENT-001 ${width}: three-booking history, viewer zone, annotations, exact record, merge, reload; icon-only controls=0`);
    } finally {await context.close();}
  }
}
