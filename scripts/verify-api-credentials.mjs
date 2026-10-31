import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { evidencePath } from "./evidence-path.mjs";
import { completeEmptyWorkspace } from "../tests/booking-axe/first-run-fixture.mjs";

const origin=process.env.DIAL_REVIEW_ORIGIN;
const browser=await chromium.launch({headless:true,...(existsSync("/usr/bin/chromium")?{executablePath:"/usr/bin/chromium"}:{}),args:["--no-sandbox","--use-mock-keychain","--password-store=basic"]});
const owner=await browser.newContext({timezoneId:"UTC"}),headers={Origin:origin};
try{
 const boot=await owner.request.post(origin+"/auth/bootstrap",{headers,data:{token:"dial-test-only-setup-token-at-least-32",displayName:"Synthetic Dial Owner",returnTo:"/setup"},maxRedirects:0});assert.equal(boot.status(),303);
 await completeEmptyWorkspace(owner,origin);await owner.request.post(origin+"/__fixtures/setup",{headers,data:{}});
 const page=await owner.newPage(),errors=[];page.on("pageerror",error=>errors.push(error.message));
 await page.setViewportSize({width:1440,height:1100});await page.goto(origin+"/app/settings");
 const access=page.locator("#operator-access");
 const adminAddress=["synthetic-dial-browser-admin","example.test"].join(String.fromCharCode(64));
 await access.getByLabel("Operator email",{exact:true}).fill(adminAddress);
 await access.getByLabel("Access level",{exact:true}).selectOption("admin");
 const invitation=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/app/api-administrators"&&response.request().method()==="POST");
 await access.getByRole("button",{name:"Invite operator",exact:true}).click();assert.equal((await invitation).status(),201);
 await expect(access.getByRole("listitem").filter({hasText:adminAddress})).toContainText("API administrator");
 for(const width of [1440,390]){await page.setViewportSize({width,height:1100});await access.scrollIntoViewIfNeeded();await access.screenshot({path:evidencePath(`api-administrator-invited-${width}.png`)});}
 await page.setViewportSize({width:1440,height:1100});
 const section=page.locator("#api-credentials"),form=section.getByRole("form",{name:"Create API access"});await form.waitFor();
 const capture=async name=>{
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1100});await section.scrollIntoViewIfNeeded();await page.evaluate(()=>globalThis.document.fonts.ready);
   if(width===1440){
    assert.ok(await page.evaluate(()=>globalThis.document.documentElement.scrollWidth<=globalThis.document.documentElement.clientWidth+1),"API Settings fits the viewport");
    const small=await section.locator("button,label,p,h2,h3,h4,code").evaluateAll(elements=>elements.filter(element=>element.getBoundingClientRect().width&&Number.parseFloat(globalThis.getComputedStyle(element).fontSize)<13).map(element=>element.tagName));assert.deepEqual(small,[]);
    const axe=await new AxeBuilder({page}).include("#api-credentials").analyze();assert.deepEqual(axe.violations.filter(row=>["serious","critical"].includes(row.impact)).map(row=>row.id),[]);
   }
   await section.screenshot({path:evidencePath(`api-credentials-${name}-${width}.png`),mask:[section.locator("[data-api-secret]"),section.locator('a[href*="code="]')]});
  }
  await page.setViewportSize({width:1440,height:1100});
 };
 await form.getByLabel("Integration name").fill("Calendar assistant");await form.getByLabel("Host access").selectOption({label:"Morgan Bell"});
 await form.getByLabel("Expires at (your local time)").fill(new Date(Date.now()+86400000).toISOString().slice(0,16));
 await form.getByLabel("Read bookings",{exact:true}).check();await form.getByLabel("Write bookings",{exact:true}).check();
 await capture("review");
 const tokenCreated=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/app/api-credentials"&&response.request().method()==="POST");
 await form.getByRole("button",{name:"Create API access"}).click();
 const tokenCreation=await tokenCreated;assert.equal(tokenCreation.status(),201,tokenCreation.status()===201?"created":JSON.stringify((await tokenCreation.json()).error));
 const oneTime=section.getByRole("region",{name:"One-time API secret"});await oneTime.waitFor();
 const token=await oneTime.locator("code").textContent();assert.equal(token.length,64);await capture("one-time-secret");
 await oneTime.getByRole("button",{name:"I stored the secret"}).click();await expect(oneTime).toHaveCount(0);
 assert.equal((await owner.request.get(origin+"/api/v1/bookings",{headers:{Authorization:`Bearer ${token}`}})).status(),200);
 await section.getByRole("button",{name:"Refresh credentials"}).click();
 const tokenRow=section.getByRole("list",{name:"Issued API access"}).getByRole("listitem").filter({hasText:"Calendar assistant"});
 await expect(tokenRow).not.toContainText("Never used");await capture("last-used");
 await page.reload();await expect(oneTime).toHaveCount(0);await expect(tokenRow).not.toContainText("Never used");
 await tokenRow.getByRole("button",{name:"Revoke access"}).click();await expect(tokenRow.getByRole("button",{name:"Revoked"})).toBeDisabled();
 assert.equal((await owner.request.get(origin+"/api/v1/bookings",{headers:{Authorization:`Bearer ${token}`}})).status(),401);
 await form.getByLabel("Access type").selectOption("authorization_code");await form.getByLabel("Integration name").fill("Scheduling connection");
 await form.getByLabel("Host access").selectOption({label:"Morgan Bell"});await form.getByLabel("Expires at (your local time)").fill(new Date(Date.now()+86400000).toISOString().slice(0,16));
 await form.getByLabel("Registered HTTPS callback").fill("https://client.example.test/callback");await form.getByLabel("Read bookings",{exact:true}).check();await form.getByLabel("Write bookings",{exact:true}).uncheck();
 const created=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/app/oauth-applications"&&response.request().method()==="POST");
 await form.getByRole("button",{name:"Create API access"}).click();const appResponse=await created;assert.equal(appResponse.status(),201);const app=await appResponse.json();await oneTime.waitFor();await oneTime.getByRole("button",{name:"I stored the secret"}).click();
 const verifier="synthetic-dial-browser-verifier-1706-abcdefghijklmnopqrstuvwxyz",query=new URLSearchParams({client_id:app.application.id,redirect_uri:"https://client.example.test/callback",response_type:"code",scope:"bookings:read",state:"synthetic-dial-browser-state",code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256"});
 const authorize=async()=>{await page.goto(origin+"/app/settings?"+query);await section.getByRole("region",{name:"Review app access"}).waitFor();};
 await authorize();await expect(section.getByRole("region",{name:"Review app access"})).toContainText("Scheduling connection");await capture("consent-review");
 await section.getByRole("button",{name:"Decline app access"}).click();const back=section.getByRole("link",{name:"Return to application"});await expect(back).toHaveAttribute("href",/error=access_denied/);
 assert.deepEqual((await (await owner.request.get(origin+"/api/app/oauth/grants")).json()).grants,[]);await capture("consent-declined");
 await authorize();await section.getByRole("button",{name:"Approve app access"}).click();await expect(back).toHaveAttribute("href",/code=/);
 const code=new URL(await back.getAttribute("href")).searchParams.get("code");
 const exchange=await owner.request.post(origin+"/api/oauth/token",{form:{grant_type:"authorization_code",client_id:app.application.id,client_secret:app.clientSecret,redirect_uri:"https://client.example.test/callback",code,code_verifier:verifier}});assert.equal(exchange.status(),200);const grant=await exchange.json();
 assert.equal((await owner.request.get(origin+"/api/v1/bookings",{headers:{Authorization:`Bearer ${grant.access_token}`}})).status(),200);
 await expect(section.getByRole("region",{name:"Connected applications"})).toContainText("Scheduling connection");await capture("connected");
 await section.getByRole("button",{name:"Disconnect app"}).click();await expect(section.getByRole("region",{name:"Connected applications"})).toHaveCount(0);
 assert.equal((await owner.request.get(origin+"/api/v1/bookings",{headers:{Authorization:`Bearer ${grant.access_token}`}})).status(),401);await capture("disconnected");
 assert.deepEqual(errors,[]);await page.close();
 console.log("API Settings: one-time secrets, scoped access, last use, revocation and delegated approval or refusal pass; screens captured at 1440 and 390.");
}finally{await owner.close();await browser.close();}
