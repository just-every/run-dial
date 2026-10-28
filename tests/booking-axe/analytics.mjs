import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { completeEmptyWorkspace } from "./first-run-fixture.mjs";

const origin=process.env.DIAL_REVIEW_ORIGIN,headers={Origin:origin};
const browser=await chromium.launch({headless:true,args:["--use-mock-keychain","--password-store=basic"]});
const owner=await browser.newContext();
const json=async(response,status=200)=>{assert.equal(response.status(),status,await response.text());return response.json();};
const external=[];
async function intercept(context) {
  await context.route("https://**/*",async route=>{
    const url=new URL(route.request().url());
    external.push({host:url.hostname,path:url.pathname,query:url.search,body:route.request().postData()});
    if(url.hostname==="www.googletagmanager.com"&&url.pathname==="/gtag/js") {
      await route.fulfill({contentType:"application/javascript",body:`(() => { const q=window.dataLayer; const send = values => { const [kind,name,params]=Array.from(values); if(kind!=='event')return; const url=new URL('https://www.google-analytics.com/g/collect'); url.searchParams.set('en',name); url.searchParams.set('dl',params.page_location); url.searchParams.set('id',params.event_id); fetch(url,{method:'POST',body:JSON.stringify({send_to:params.send_to,transaction_id:params.transaction_id})}).then(()=>params.event_callback?.()); }; q.forEach(send); const push=q.push.bind(q); q.push=(...values)=>{values.forEach(send);return push(...values);}; })();`});return;
    }
    if(url.hostname==="www.google-analytics.com") { await route.fulfill({status:204});return; }
    if(["www.googletagmanager.com","connect.facebook.net","snap.licdn.com"].includes(url.hostname)) {await route.fulfill({contentType:"application/javascript",body:"try { window.parent.document.body; throw new Error('Vendor reached booking DOM'); } catch (error) { if (error.message === 'Vendor reached booking DOM') throw error; } if (location.search || document.referrer) throw new Error('Vendor received booking query or referrer');"});return;}
    throw new Error(`Unexpected third-party hostname ${url.hostname}`);
  });
}
async function shot(page,name,target) {
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});await page.evaluate(()=>globalThis.document.fonts.ready);
    const region=target??page.locator("main");await region.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.document.documentElement.clientWidth+1),`${name}: no horizontal overflow at ${width}`);
    const small=await region.locator("input,button,label,p,summary").evaluateAll(elements=>elements.filter(element=>element.getClientRects().length&&Number.parseFloat(globalThis.getComputedStyle(element).fontSize)<13).map(element=>element.tagName));
    assert.deepEqual(small,[],`${name}: readable text at ${width}`);
    await region.screenshot({path:evidencePath(`analytics-${name}-${width}.png`)});
  }
  await page.setViewportSize({width:1440,height:1000});
}
try {
  assert.equal((await owner.request.post(origin+"/auth/bootstrap",{headers,data:{token:"dial-test-only-setup-token-at-least-32",displayName:"Synthetic Dial Owner",returnTo:"/setup"},maxRedirects:0})).status(),303);
  await completeEmptyWorkspace(owner,origin);await json(await owner.request.post(origin+"/__fixtures/setup",{headers,data:{}}));
  const event=await json(await owner.request.post(origin+"/api/app/event-types",{headers,data:{slug:"launch-consultation",title:"Launch consultation",description:"A focused conversation about your next launch.",durationMinutes:30,color:"#176b5a",locationType:"fixed_link",locationLabel:"Video call",locationValue:"https://example.test/room",listed:true,alternativeRequestsEnabled:false,slotIncrementMinutes:30,minimumNoticeMinutes:0,bookingHorizonDays:90,beforeBufferMinutes:0,afterBufferMinutes:0,hostDayBookingLimit:null,questions:[{kind:"text",key:"q_0000000900",label:"Private launch plan",required:true,private:true,options:[]}],availability:Array.from({length:7},(_,weekday)=>({weekday,startMinute:600,endMinute:1200}))}}),201);
  await json(await owner.request.post(`${origin}/api/app/event-types/${event.id}/publish`,{headers,data:{}}));
  const future=new Date(Date.now()+10*86400000).toISOString().slice(0,10),path=`/book/dial-host/${event.slug}`,link=path+"?"+new URLSearchParams({week:future,gclid:"synthetic-dial-google-920",li_fat_id:"synthetic-dial-linkedin-920","answer.q_0000000900":"synthetic-dial-private-920"});
  const unconfigured=await browser.newContext();await intercept(unconfigured);let page=await unconfigured.newPage();
  await page.goto(origin+link);await page.getByRole("heading",{name:"Choose a day and time."}).waitFor();
  await page.waitForLoadState("networkidle");assert.deepEqual(external,[],"an unconfigured booking page makes no third-party request");await unconfigured.close();
  const settings=await owner.newPage();await settings.goto(origin+"/app/settings");
  const card=settings.locator("#analytics-settings");await card.getByLabel("GA4 measurement ID").waitFor();
  async function set(label,value) {const field=card.getByLabel(label,{exact:true});await field.fill(value);const saved=settings.waitForResponse(response=>new URL(response.url()).pathname==="/api/app/analytics"&&response.request().method()==="PUT"&&JSON.stringify(response.request().postDataJSON()).includes(JSON.stringify(value)));await field.blur();assert.equal((await saved).status(),200);}
  await set("GA4 measurement ID","G-SYNTHETIC920");
  await settings.reload();assert.equal(await card.getByLabel("GA4 measurement ID").inputValue(),"G-SYNTHETIC920");
  await shot(settings,"settings",card);
  await json(await owner.request.put(origin+"/api/app/embed-settings",{headers,data:{allowedOrigins:["https://studio.example.test"]}}));
  const embedded=await browser.newContext();await intercept(embedded);const embeddedPage=await embedded.newPage(),beforeEmbed=external.length;
  await embeddedPage.goto(origin+`/embed/dial-host/${event.slug}?`+new URLSearchParams({parent:"https://studio.example.test",week:future}));await embeddedPage.getByRole("heading",{name:"Choose a day and time."}).waitFor();await embeddedPage.waitForLoadState("networkidle");
  assert.equal(external.length,beforeEmbed,"configured embeds leave analytics to their parent and load no vendor scripts");await shot(embeddedPage,"embed");await embedded.close();
  const invitee=await browser.newContext();await intercept(invitee);page=await invitee.newPage();
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(origin+link);await page.getByRole("heading",{name:"Choose a day and time."}).waitFor();
  const events=()=>external.filter(item=>item.host==="www.google-analytics.com").map(item=>new URLSearchParams(item.query).get("en"));
  await assertEventually(()=>events().includes("page_view"));
  await shot(page,"choose-time");
  const times=page.getByRole("button",{name:/\d.*(?:AM|PM|am|pm)/});await times.first().waitFor();await times.first().click();
  await page.getByLabel("Name",{exact:true}).waitFor();await page.getByLabel("Name",{exact:true}).fill("Synthetic Dial Invitee");await page.getByLabel("Email",{exact:true}).fill(["synthetic-dial-920","example.test"].join("@"));
  assert.equal(new URL(page.url()).searchParams.get("gclid"),"synthetic-dial-google-920");assert.equal(new URL(page.url()).searchParams.get("li_fat_id"),"synthetic-dial-linkedin-920");
  await page.getByLabel("Private launch plan",{exact:false}).fill("synthetic-dial-private-920");await shot(page,"details");
  const confirmation=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith("/confirm")&&response.request().method()==="POST");
  await page.getByRole("button",{name:"Confirm booking",exact:true}).click();const response=await confirmation;assert.equal(response.status(),201);const booking=await response.json();
  assert.deepEqual(response.request().postDataJSON().clickIds,{gclid:"synthetic-dial-google-920",li_fat_id:"synthetic-dial-linkedin-920"},"the booking link click context reaches the confirmation public door");
  await page.waitForURL(url=>url.pathname.endsWith("/confirmed"));await page.getByRole("heading",{name:"Booking confirmed."}).waitFor();
  await assertEventually(()=>events().includes("booking_confirmed"));
  assert.deepEqual(events().sort(),["booking_confirmed","page_view","slot_selected"],"GA4 captures exactly one of each booking event across document navigation");
  for(const item of external.filter(item=>item.host==="www.google-analytics.com")) {
    assert.equal(new URLSearchParams(item.query).get("dl"),origin+path);
    assert.ok(!JSON.stringify(item).includes("synthetic-dial-private-920"));assert.ok(!JSON.stringify(item).includes("synthetic-dial-google-920"));assert.ok(!JSON.stringify(item).includes("nonce"));
  }
  await shot(page,"confirmed");await page.reload();await page.getByRole("heading",{name:"Booking confirmed."}).waitFor();
  assert.deepEqual(events().sort(),["booking_confirmed","page_view","slot_selected"],"receipt refresh does not replay conversion");
  await page.goto(booking.manageUrl);await page.getByRole("heading",{name:event.title,exact:true}).waitFor();await page.waitForFunction(()=>Array.from(globalThis.document.querySelectorAll("button")).some(button=>button.textContent==="Cancel booking"&&!button.disabled));await shot(page,"manage");assert.deepEqual(errors,[]);
  await page.goto(origin+"/privacy");await page.getByText(/When the host configures them/).waitFor();const disclosure=await page.getByText(/When the host configures them/).textContent();for(const provider of ["Google Analytics 4","Google Tag Manager","Meta Pixel","Google Ads","LinkedIn Insight Tag"])assert.ok(disclosure.includes(provider),"the invitee notice discloses each supported provider");await shot(page,"privacy");
  await invitee.close();
  await settings.goto(origin+"/app/settings");await card.getByLabel("GTM container ID").waitFor();
  await set("GTM container ID","GTM-SYNTHETIC920");await set("Meta Pixel ID","920");
  // A tag enables only after both its ID and label have been entered.
  await card.getByLabel("Google Ads conversion tag",{exact:true}).fill("AW-920");await card.getByLabel("Google Ads conversion label",{exact:true}).fill("synthetic-dial-920");
  await set("LinkedIn Insight partner ID","921");
  assert.deepEqual(await json(await owner.request.get(origin+"/api/app/analytics")),{ga4MeasurementId:"G-SYNTHETIC920",gtmContainerId:"GTM-SYNTHETIC920",metaPixelId:"920",googleAds:{conversionId:"AW-920",conversionLabel:"synthetic-dial-920"},linkedInPartnerId:"921"});
  for(const [provider,label] of [["google_ads","Google Ads"],["linkedin","LinkedIn Ads"]]) {
    await card.locator("summary").filter({hasText:label+" conversions"}).click();
    const form=card.getByRole("form",{name:`Connect ${label} conversions`,exact:true});
    await form.getByLabel(`${label} access token`,{exact:true}).fill(`synthetic-dial-${provider==="google_ads"?900:901}`);
    if(provider==="google_ads") {
      await form.getByLabel("Google Ads developer token",{exact:true}).fill("synthetic-dial-902");
      await form.getByLabel("Google Ads customer ID",{exact:true}).fill("1234567890");
      await form.getByLabel("Google Ads conversion action",{exact:true}).fill(["customers","1234567890","conversionActions","900"].join("/"));
    } else await form.getByLabel("LinkedIn conversion ID",{exact:true}).fill("901");
    const saved=settings.waitForResponse(response=>new URL(response.url()).pathname===`/api/app/analytics/connections/${provider}`&&response.request().method()==="PUT");
    await form.getByRole("button",{name:`Connect ${label}`,exact:true}).click();assert.equal((await saved).status(),200);
    await card.getByRole("button",{name:`Disconnect ${label}`,exact:true}).waitFor();
    assert.equal(await form.getByLabel(`${label} access token`,{exact:true}).inputValue(),"");
  }
  await shot(settings,"connections",card);
  const allTags=await browser.newContext();await intercept(allTags);const all=await allTags.newPage(),allErrors=[];all.on("pageerror",error=>allErrors.push(error.message));await all.goto(origin+link);await all.getByRole("heading",{name:"Choose a day and time."}).waitFor();
  await assertEventually(()=>["www.googletagmanager.com","connect.facebook.net","snap.licdn.com"].every(host=>external.some(item=>item.host===host)));
  await all.waitForLoadState("networkidle");assert.deepEqual(allErrors,[],"vendor scripts cannot inspect parent booking DOM, queries or referrers");
  assert.ok(external.some(item=>item.path==="/gtm.js"));await allTags.close();
  await json(await owner.request.put(origin+"/api/app/analytics",{headers,data:{}}));
  const before=external.length,disabled=await browser.newContext();await intercept(disabled);const blank=await disabled.newPage();await blank.goto(origin+link);await blank.getByRole("heading",{name:"Choose a day and time."}).waitFor();await blank.waitForLoadState("networkidle");assert.equal(external.length,before,"removing all tags stops vendor scripts");await disabled.close();
  await settings.close();
  console.log("INTEG-006 browser: configured GA4 events once; all optional tags; unconfigured silence; sanitized payloads; saved owner controls and 1440/390 screens.");
} finally {await owner.close();await browser.close();}
async function assertEventually(check) {for(let attempt=0;attempt<80;attempt++){if(check())return;await new Promise(done=>setTimeout(done,100));}assert.ok(check(),"expected captured analytics event");}
