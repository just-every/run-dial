import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { completeEmptyWorkspace } from '../tests/booking-axe/first-run-fixture.mjs';
import { routingScreens } from '../tests/booking-axe/routing.mjs';
const origin=process.env.DIAL_REVIEW_ORIGIN??'http://127.0.0.1:15752';
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']}),owner=await browser.newContext();
try{
 const boot=await owner.request.post(origin+'/auth/bootstrap',{headers:{Origin:origin},data:{token:'dial-test-only-setup-token-at-least-32',displayName:'Synthetic Dial Owner',returnTo:'/setup'},maxRedirects:0});assert.equal(boot.status(),303);
 await completeEmptyWorkspace(owner,origin);assert.equal((await owner.request.post(origin+'/__fixtures/setup',{data:{}})).status(),200);
 await routingScreens(browser,owner,origin);console.log('Routing Settings, public form, inline form, message, booking and conversion at 1440 and 390 passed.');
}finally{await owner.close();await browser.close();}
