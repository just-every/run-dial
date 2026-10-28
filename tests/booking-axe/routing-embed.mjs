import assert from 'node:assert/strict';
import { evidencePath } from '../../scripts/evidence-path.mjs';
import { routingAnswers } from '../booking-wire/routing-journey.mjs';

export async function routingEmbeds({browser,settings,origin,form,event,width,fill}){
 const parent='http://localhost:15752',context=await browser.newContext({viewport:{width,height:960},extraHTTPHeaders:{'CF-Connecting-IP':width===390?'192.0.2.193':'192.0.2.194'}}),page=await context.newPage();
 await context.grantPermissions(['local-network-access'],{origin:parent});
 await page.addInitScript(()=>{globalThis.routingEvents=[];globalThis.addEventListener('dial:routing-viewed',event=>globalThis.routingEvents.push({type:event.type,...event.detail}));globalThis.addEventListener('dial:routing-submitted',event=>globalThis.routingEvents.push({type:event.type,...event.detail}));});
 const diagnostics=[];page.on('pageerror',error=>diagnostics.push(error.message));page.on('console',message=>{if(message.type()==='error')diagnostics.push(message.text());});page.on('requestfailed',request=>diagnostics.push(request.url()+' '+request.failure()?.errorText));
 const thirdParty=[];context.on('request',request=>{if(['www.googletagmanager.com','www.google-analytics.com','connect.facebook.net','snap.licdn.com'].includes(new URL(request.url()).hostname))thirdParty.push(request.url());});
 try{
  for(const mode of ['inline','modal']){
   await settings.getByLabel(/^Embed style/).selectOption(mode);
   const snippet=(await settings.getByLabel(/^Website embed code/).inputValue()).replace('/embed/dial.js','/embed/dial.js?utm_source='+mode);
   const url=`${parent}/routing-${mode}`;
   await page.route(url,route=>route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Growth studio</title></head><body style="margin:0"><main><h1>Find your next step</h1>${snippet}</main></body></html>`}));
   await page.goto(url);await page.waitForFunction(()=>globalThis.document.querySelector('script[data-dial-routing]')?.dataset.dialMounted==='true').catch(async error=>{console.log('ROUTING_EMBED_STATE '+JSON.stringify({diagnostics,snippet,html:await page.locator('main').innerHTML()}));throw error;});
   if(mode==='modal'){assert.equal(await page.locator('iframe').count(),0);await page.locator('button[data-dial-embed]').click();await page.getByRole('dialog').waitFor();}
   const frame=page.frameLocator('iframe');await frame.getByLabel('Your name',{exact:false}).waitFor();await fill(frame,routingAnswers(width+10));await frame.getByRole('heading').first().scrollIntoViewIfNeeded();
   await page.locator('iframe').screenshot({path:evidencePath(`routing-${mode}-embed-${width}.png`)});
   await frame.getByRole('button',{name:'Continue',exact:true}).click();await frame.locator('.pb-slot-button').first().waitFor();
   const destination=page.frames().find(candidate=>candidate.url().startsWith(`${origin}/embed/dial-host/${event.slug}`));assert.ok(destination,'the real async bootstrap carries the form into the embedded booking flow');assert.equal(new URL(destination.url()).searchParams.get('parent'),parent);assert.equal(new URL(destination.url()).searchParams.get('utm_source'),mode);assert.ok(new URL(destination.url()).searchParams.get('routeToken'));
   const events=await page.evaluate(()=>globalThis.routingEvents);assert.equal(events.filter(event=>event.type==='dial:routing-viewed').length,1);assert.equal(events.filter(event=>event.type==='dial:routing-submitted').length,1);assert.deepEqual(Object.keys(events[0]).sort(),['slug','type']);assert.deepEqual(Object.keys(events[1]).sort(),['submissionReference','type']);assert.equal(events[0].slug,form.slug);assert.ok(events[1].submissionReference);assert.ok(!JSON.stringify(events).includes('routeToken'));
   if(mode==='modal'){await page.getByRole('button',{name:'Close scheduling window'}).click();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('button[data-dial-embed]').evaluate(node=>node===globalThis.document.activeElement),true);}
  }
  assert.deepEqual(thirdParty,[],'configured embeds send parent events and load no third-party analytics');
  const refused=await context.request.get(`${origin}/embed/route/${form.slug}/form?parent=https%3A%2F%2Fdenied.example.test`);assert.equal(refused.status(),404);assert.ok(!(await refused.text()).includes(form.title),'a denied parent receives no form projection');
 }finally{await context.close();}
}
