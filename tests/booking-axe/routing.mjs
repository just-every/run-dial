import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import { evidencePath } from '../../scripts/evidence-path.mjs';
import { routingAnswers,routingInput,routingEvent } from '../booking-wire/routing-journey.mjs';
export async function routingScreens(browser,owner,origin) {
 const headers={Origin:origin};
 const data=async(path,body,expected=200,method=body===undefined?'GET':'POST')=>{const response=await owner.request.fetch(origin+path,{method,headers,...(body===undefined?{}:{data:body})});assert.equal(response.status(),expected,await response.text());return response.json();};
 const event=await routingEvent(data,'routing-browser'),input=routingInput(event.id,'routing-browser'),form=await data('/api/app/routing-forms',input,201),errors=[];
 await data('/api/app/embed-settings',{allowedOrigins:['https://studio.example.test']},200,'PUT');
 for(const width of [1440,390]){
  const page=await owner.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:960});
  try{
   await page.goto(origin+'/app/settings/routing');await page.getByRole('heading',{name:'Routing forms',exact:true}).waitFor();
   await page.getByLabel('Edit a routing form',{exact:true}).selectOption(form.id);
   await page.getByLabel('Form title',{exact:true}).fill(`Growth consultation ${width}`);await page.getByLabel('Form title',{exact:true}).blur();await page.getByRole('status').filter({hasText:'All changes saved'}).waitFor();
   assert.equal((await data(`/api/app/routing-forms/${form.id}`)).form.title,`Growth consultation ${width}`,'operator edits persist through the Settings public door');
   await capture(page,width,'routing-settings');
   const publicContext=await browser.newContext({viewport:{width,height:960}}),visitor=await publicContext.newPage();visitor.on('pageerror',e=>errors.push(e.message));
   try{
    await visitor.goto(`${origin}/route/${form.slug}?utm_source=website`);await visitor.getByRole('heading',{name:`Growth consultation ${width}`}).waitFor();
    const nameField=await visitor.getByLabel('Your name',{exact:false}).boundingBox(),emailField=await visitor.getByLabel('Work email',{exact:false}).boundingBox();assert.ok(emailField.y>nameField.y,'questions appear in configured order');
    await fill(visitor,routingAnswers(width));await capture(visitor,width,'routing-public');
    await visitor.getByRole('button',{name:'Continue',exact:true}).click();await visitor.waitForURL(url=>url.pathname===`/book/dial-host/${event.slug}`);
    const routeToken=new URL(visitor.url()).searchParams.get('routeToken');assert.ok(routeToken);assert.equal(new URL(visitor.url()).searchParams.get('utm_source'),'website');
    const week=new Date(Date.now()+10*86400000).toISOString().slice(0,10),base=`/api/public/book/dial-host/${event.slug}`,slot=(await data(`${base}/availability?week=${week}`)).slots[0];assert.ok(slot);
    const selection=await data(`${base}/selection`,{startAt:slot.startAt,inviteeTimezone:'UTC'},201),params=new URLSearchParams(new URL(visitor.url()).search);
    params.set('nonce',selection.nonce);params.set('startAt',slot.startAt);params.set('inviteeTimezone','UTC');await visitor.goto(`${origin}/book/dial-host/${event.slug}/details?${params}`);
    await visitor.getByRole('button',{name:'Confirm booking',exact:true}).waitFor();assert.equal(await visitor.getByLabel('Name',{exact:true}).inputValue(),'Taylor Chen');assert.equal(await visitor.getByLabel('Project goal',{exact:true}).inputValue(),'Plan expansion');
    await visitor.getByLabel('Name',{exact:true}).fill('Taylor Morgan');await visitor.getByLabel('Email',{exact:true}).fill(`synthetic-dial-${width}-edited`+'@'+'example.test');await capture(visitor,width,'routing-booking');
    let landed;
    await visitor.route('https://studio.example.test/**',async route=>{landed=new URL(route.request().url());await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html lang="en"><title>Consultation received</title><main><h1>Thank you for booking</h1></main></html>'});});
    await visitor.getByRole('button',{name:'Confirm booking',exact:true}).click();await visitor.getByRole('heading',{name:'Thank you for booking'}).waitFor();assert.ok(landed);assert.equal(landed.searchParams.get('name'),'Taylor Morgan');assert.equal(landed.searchParams.get('utm_source'),'website');assert.equal(landed.searchParams.get('event'),event.title);assert.ok(landed.searchParams.get('start_time'));assert.equal(landed.searchParams.has('token'),false);assert.equal(landed.searchParams.has('routeToken'),false);assert.equal(landed.searchParams.has('answer.confidential'),false);
    await visitor.goto(`${origin}/route/${form.slug}?utm_source=guide`);await fill(visitor,{...routingAnswers(width+1),budget:'50'});await visitor.getByRole('button',{name:'Continue',exact:true}).click();await visitor.getByRole('status').getByText(input.rules[1].outcome.message).waitFor();await capture(visitor,width,'routing-message');
    await visitor.goto(`${origin}/embed/route/${form.slug}?parent=https%3A%2F%2Fstudio.example.test&utm_source=inline`);await visitor.getByLabel('Your name',{exact:false}).waitFor();await fill(visitor,routingAnswers(width+2));await capture(visitor,width,'routing-inline');await visitor.getByRole('button',{name:'Continue',exact:true}).click();await visitor.waitForURL(url=>url.pathname===`/embed/dial-host/${event.slug}`);assert.equal(new URL(visitor.url()).searchParams.get('parent'),'https://studio.example.test');
    await page.getByRole('button',{name:'Refresh submissions',exact:true}).click();await page.getByRole('button',{name:'Growth consultation',exact:true}).first().waitFor();await page.getByRole('button',{name:'Growth consultation',exact:true}).first().click();assert.ok(await page.getByRole('link',{name:/^Booking /}).count());await capture(page,width,'routing-conversion');
   }finally{await publicContext.close();}
  }finally{await page.close();}
 }
 assert.deepEqual(errors,[]);
}
async function fill(page,answers){
 const labels={name:'Your name',email:'Work email',phone:'Phone number',employees:'Company size',budget:'Budget',country:'Country',state:'US state',q_project_goal_2026:'Project goal',confidential:'Private context'};
 for(const [key,label]of Object.entries(labels))await page.getByLabel(label,{exact:false}).fill(answers[key]);
 for(const [key,label]of [['service','Service'],['stage','Stage']])await page.getByLabel(label,{exact:false}).selectOption(answers[key]);
 for(const option of answers.interests)await page.getByLabel(option,{exact:true}).check();
}
async function capture(page,width,name){
 await page.evaluate(()=>globalThis.document.fonts.ready);
 assert.ok(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.document.documentElement.clientWidth+1),`${name} fits ${width}`);
 const axe=await new AxeBuilder({page}).analyze();assert.deepEqual(axe.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>`${v.id}: ${v.nodes.map(n=>n.target.join(' ')).join(', ')}`),[]);
 const tiny=await page.locator('main').evaluate(root=>[...root.querySelectorAll('input,select,textarea,button,label,p,summary,td,th,h1,h2,h3,a')].filter(el=>el.getClientRects().length&&Number.parseFloat(globalThis.getComputedStyle(el).fontSize)<13).map(el=>el.tagName));assert.deepEqual(tiny,[],'routing screens keep everyday text at least 13px');
 await page.screenshot({path:evidencePath(`${name}-${width}.png`),fullPage:true});
}
