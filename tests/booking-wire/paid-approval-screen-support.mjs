import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import {completeEmptyWorkspace} from '../booking-axe/first-run-fixture.mjs';
import {paidApprovalSupport} from './paid-approval-support.mjs';
export async function paidApprovalScreensSupport({browser,origin,folder,storageState,initialize=true}){
  await mkdir(folder,{recursive:true});const owner=await browser.newContext(storageState?{storageState}:{}),publicContext=await browser.newContext(),shots=[];
  async function call(path,body,expected=200,method=body===undefined?'GET':'POST'){
    const response=await owner.request.fetch(origin+path,{method,headers:{Origin:origin},...(body===undefined?{}:{data:body}),maxRedirects:0});assert.ok((Array.isArray(expected)?expected:[expected]).includes(response.status()),`${method} ${path.replace(/\/manage\/[^/?]+/g,'/manage/[redacted]')}: ${response.status()}`);return {status:response.status(),json:()=>response.json(),headers:new Headers(response.headers())};
  }
  const data=async(...args)=>(await call(...args)).json();
  if(initialize){await call('/auth/bootstrap',{token:'dial-test-only-setup-token-at-least-32',displayName:'Morgan Bell',returnTo:'/setup'},303);await completeEmptyWorkspace(owner,origin);}
  await data('/__fixtures/setup',{});
  const start=new URL((await call('/api/app/payments/stripe/oauth/start',undefined,302)).headers.get('location'));await call('/api/payments/stripe/oauth/callback?'+new URLSearchParams({state:start.searchParams.get('state'),code:'wire-stripe-consent'}),undefined,302);
  const state=async()=>({...await data('/__fixtures/payments/all-rows'),...await data('/__fixtures/payments/processor-state')});
  const h=await paidApprovalSupport({data,call,state,origin,future:new Date(Date.now()+10*86400000).toISOString().slice(0,10)});
  async function capture(name,path,ready,{session=false}={}){
    for(const width of [1440,390]){
      const page=await(session?owner:publicContext).newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width,height:width===1440?1024:844});
      try{await page.goto(new URL(path,origin).toString());await page.waitForLoadState('networkidle');const target=await ready(page);await page.evaluate(()=>globalThis.document.fonts.ready);assert.ok(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.document.documentElement.clientWidth+1),`${name} no overflow`);const axe=await new AxeBuilder({page}).analyze();assert.deepEqual(axe.violations.filter(row=>['critical','serious'].includes(row.impact)).map(row=>row.id),[]);assert.deepEqual(errors,[]);const iconControls=await(target??page.locator('main')).locator('button,a').evaluateAll(elements=>elements.filter(element=>element.getBoundingClientRect().width>0&&!element.textContent.trim()&&element.querySelector('svg')).map(element=>element.getAttribute('aria-label')??'unnamed'));assert.deepEqual(iconControls,[],`${name}: every control has a visible text label`);await(target??page).screenshot({path:`${folder}/${name}-${width}.png`,...(target?{}:{fullPage:true})});shots.push(`${name}-${width}.png`);}finally{await page.close();}
    }
  }
  const manage=async held=>(await data('/api/public/payments/'+held.returnToken)).approvalUrl;
  const details=selected=>`/book/dial-host/${selected.event.slug}/details?${new URLSearchParams({nonce:selected.nonce,startAt:selected.selection.startAt,inviteeTimezone:'UTC'})}`;
  async function finish(){return shots;}
  return {...h,owner,publicContext,capture,manage,details,finish,shots,close:async()=>{await owner.close();await publicContext.close();}};
}
