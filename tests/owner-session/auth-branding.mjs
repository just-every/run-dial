import {contract} from '../contract.mjs';
import assert from 'node:assert/strict';
import {magicCandidates,selectMagicReceipt} from '../../scripts/owner-session/mail-matching.mjs';
import {linkMessage} from '../../modules/operator-auth/identity/email-link/message.mjs';
import {confirmationResponse} from '../../modules/operator-auth/identity/email-link/confirmation.mjs';
const branding={productName:'Dial',accentColor:'#176b5a',signInPath:'/signin'};
const origin='https://dial-session-check.fixture.workers.dev',recipient='qa@example.test';
const token='synthetic-test-only-magic-token-more-than-32-bytes';
const url=origin+'/auth/confirm?token='+token;
const snapshot={ids:['old'],at:'2026-10-07T00:00:00Z'};
const mail=linkMessage({branding,linkSeconds:600},{kind:'magic'},url);
const receipt={id:'fresh',receivedAt:'2026-10-07T00:00:01Z',to:recipient,subject:mail.subject,excerpt:mail.text};

contract('BASE-SECRET-001', 'adopted Base branded Dial sign-in mail matches the exact harness receipt contract',()=>{
 assert.equal(mail.subject,'Your sign-in link for Dial');
 assert.ok(mail.text.includes('press Confirm to sign in to Dial'));
 assert.match(mail.html,/<h1>Confirm sign-in to Dial<\/h1>/);
 assert.equal(mail.text.split(url).length-1,1);assert.equal(mail.html.split(url).length-1,1);
 const matches=magicCandidates(receipt,snapshot,recipient,origin);
 assert.equal(matches.length,1);assert.equal(matches[0].u.href,url);
 for(const patch of [
  {subject:'Your sign-in link'},{subject:'Your sign-in link for Other'},
  {subject:"You're invited to Dial"},{id:'old'},{to:'wrong@example.com'},
  {receivedAt:'2026-10-06T00:00:00Z'},{receivedAt:'invalid'},
  {excerpt:mail.text.replace(origin,'https://other.example')},
  {excerpt:mail.text.replace('/auth/confirm','/signin')},
  {excerpt:mail.text.replace(token,'short')}
 ])assert.equal(magicCandidates({...receipt,...patch},snapshot,recipient,origin).length,0);
 const invitation=linkMessage({branding,linkSeconds:600},{kind:'invite'},url);
 assert.equal(invitation.subject,"You're invited to Dial");
 assert.equal(magicCandidates({...receipt,subject:invitation.subject,excerpt:invitation.text},snapshot,recipient,origin).length,0);
});

contract('BASE-SECRET-001', 'sign-in mailbox selection preserves one matching receipt and refuses duplicate links or receipts without resend',()=>{
 assert.equal(selectMagicReceipt([receipt,{...receipt,id:'old'}],snapshot,recipient,origin).x.id,'fresh');
 assert.equal(selectMagicReceipt([{...receipt,subject:'Other'}],snapshot,recipient,origin),undefined);
 assert.throws(()=>selectMagicReceipt([receipt,{...receipt,id:'second'}],snapshot,recipient,origin),/ambiguous-signin-receipt-no-resend/);
 assert.throws(()=>selectMagicReceipt([{...receipt,excerpt:mail.text+'\n'+url}],snapshot,recipient,origin),/ambiguous-signin-receipt-no-resend/);
});

contract('BASE-SECRET-001', 'adopted Base Dial confirmation keeps exact Confirm while expired pages offer Request a new link',async()=>{
 const valid=await confirmationResponse({branding,preview:{kind:'magic',expiresInMinutes:10},token,method:'GET'});
 assert.equal(valid.status,200);assert.equal(valid.headers.get('set-cookie'),null);
 const html=await valid.text();assert.match(html,/<h1>Confirm sign-in to Dial<\/h1>/);
 assert.match(html,/<button type="submit">Confirm<\/button>/);assert.equal((html.match(/<button\b/g)??[]).length,1);
 assert.match(html,/name="token"/);assert.equal(html.split(token).length-1,1);
 for(const method of ['GET','HEAD']) {
  const expired=await confirmationResponse({branding,preview:null,token,method});
  assert.equal(expired.status,400);assert.equal(expired.headers.get('set-cookie'),null);
  const body=await expired.text();
  if(method==='HEAD')assert.equal(body,'');
  else {
   assert.match(body,/<h1>This link is invalid or expired<\/h1>/);
   assert.match(body,/<a class="action" href="\/signin">Request a new link<\/a>/);
   assert.match(body,/<style>/);assert.match(body,/class="brand"/);
   assert.ok(!body.includes(token));assert.doesNotMatch(body,/<form\b|<button\b/);
  }
 }
});

contract('BASE-SECRET-001','received sign-in raw MIME retains both native Dial parts and the exact fresh capability',async()=>{
 const {assertSigninMime}=await import('../../scripts/owner-session/mime-proof.mjs');
 const raw=`Content-Type: multipart/alternative; boundary="signin"\r\n\r\n--signin\r\nContent-Type: text/plain\r\n\r\n${mail.text}\r\n--signin\r\nContent-Type: text/html\r\n\r\n${mail.html}\r\n--signin--\r\n`;
 assert.deepEqual(assertSigninMime(raw,url),{parts:['text/plain','text/html'],branding:'Dial',linkMatched:true});
 assert.throws(()=>assertSigninMime(raw,url+'other'),/link-mismatch/);
 assert.throws(()=>assertSigninMime('Content-Type: text/plain\r\n\r\n'+mail.text,url),/multipart-alternative-required/);
});
