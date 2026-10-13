import {contract} from '../contract.mjs';
import assert from 'node:assert/strict';
import {rawMailTarget,resolveRawMime} from '../../scripts/owner-session/raw-mail.mjs';
import {assertAcknowledgementMime} from '../../scripts/owner-session/mime-proof.mjs';
import {selectAcknowledgementReceipt} from '../../scripts/owner-session/mail-matching.mjs';

const mailboxUrl='https://mailbox.example/receipts?token=synthetic-auth-only&limit=20';
const rawUrl='https://mailbox.example/service-supplied/nested/file.eml?message=opaque';
const raw='MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSynthetic receipt.';
contract('BASE-SECRET-001', 'raw retrieval receipt selection rechecks the original freshness, recipient, subject and install plus exact recorded identity',()=>{
 const origin='https://dial-session-check.fixture.workers.dev',recipient='qa@example.test';
 const filter={recipient,origin,subject:'We received your time request for '+origin+' proof'};
 const snapshot={ids:['old'],at:'2026-10-07T00:00:00Z'},recorded={id:'chosen',receivedAt:'2026-10-07T00:00:01Z'};
 const row={...recorded,subject:filter.subject,to:recipient,excerpt:origin,rawUrl};
 assert.equal(selectAcknowledgementReceipt([row],recorded,snapshot,filter),row);
 for(const change of [{id:'different'},{id:'old'},{receivedAt:'2026-10-07T00:00:02Z'},{receivedAt:'2026-10-06T00:00:00Z'},{to:'other@example.com'},{subject:'other'},{excerpt:'https://other.example'}])assert.throws(()=>selectAcknowledgementReceipt([{...row,...change}],recorded,snapshot,filter),/receipt-identity/);
 assert.throws(()=>selectAcknowledgementReceipt([row,{...row,id:'second'}],recorded,snapshot,filter),/receipt-identity/);
});
function response(url,{body=raw,status=200,type='message/rfc822',redirected=false,length}={}) {
 const value=new Response(body,{status,headers:{'content-type':type,...(length===undefined?{}:{'content-length':String(length)})}});
 Object.defineProperties(value,{url:{value:url},redirected:{value:redirected}});return value;
}
contract('BASE-SECRET-001', 'raw receipt retrieval uses the exact service path and only same-origin endpoint token in memory once',async()=>{
 const receipt={id:'receipt-id',rawUrl},before=JSON.stringify(receipt);let calls=0;
 const result=await resolveRawMime(receipt,{mailboxUrl,request:async(url,options)=>{
  calls++;const target=new URL(url);assert.equal(target.origin,'https://mailbox.example');assert.equal(target.pathname,'/service-supplied/nested/file.eml');
  assert.deepEqual([...target.searchParams],[['message','opaque'],['token','synthetic-auth-only']]);
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');
  assert.deepEqual(options.headers,{Accept:'message/rfc822'});assert.ok(options.signal instanceof AbortSignal);
  return response(url);
 }});
 assert.equal(result,raw);assert.equal(calls,1);assert.equal(JSON.stringify(receipt),before);
 assert.throws(()=>assertAcknowledgementMime(result,{title:'Synthetic',hostName:'Receipt'}),/multipart-alternative-required/);
 const existing=rawMailTarget(rawUrl+'&token=synthetic-auth-only',mailboxUrl);assert.equal(existing.searchParams.getAll('token').length,1);
});
contract('BASE-SECRET-001', 'raw retrieval rejects wrong origin, scheme, credentials, fragments or token ambiguity before fetch',async()=>{
 let calls=0;const request=async()=>{calls++;throw Error('must-not-fetch');};
 for(const changed of [rawUrl.replace('mailbox.example','foreign.example'),rawUrl.replace('https:','http:'),rawUrl.replace('https://','https://user:password@'),rawUrl+'#fragment',rawUrl+'&token=other',rawUrl+'&token=synthetic-auth-only&token=synthetic-auth-only','//foreign.example/raw',''])await assert.rejects(()=>resolveRawMime({rawUrl:changed},{mailboxUrl,request}));
 for(const endpoint of ['https://mailbox.example/receipts',mailboxUrl+'&token=second',mailboxUrl.replace('https:','http:'),mailboxUrl.replace('https://','https://user:password@')])await assert.rejects(()=>resolveRawMime({rawUrl},{mailboxUrl:endpoint,request}));
 assert.equal(calls,0);
});
contract('BASE-SECRET-001', 'actual relative raw URL is resolved only against endpoint origin, preserving its path/query and adding only auth',async()=>{
 const supplied='/receipt-specific/nested/message.eml?download=raw';let calls=0;
 assert.equal(await resolveRawMime({rawUrl:supplied},{mailboxUrl:'https://mailbox.example/other/base/receipts?token=synthetic-auth-only&limit=20',request:async(url)=>{
  calls++;const target=new URL(url);assert.equal(target.pathname,'/receipt-specific/nested/message.eml');
  assert.deepEqual([...target.searchParams],[['download','raw'],['token','synthetic-auth-only']]);return response(url);
 }}),raw);assert.equal(calls,1);
 const relative=rawMailTarget('receipt-specific/message.eml?download=raw',mailboxUrl);
 assert.equal(relative.pathname,'/receipt-specific/message.eml');assert.equal(relative.searchParams.has('limit'),false);
 const encoded=rawMailTarget('/receipt-specific/message.eml?opaque=a%20b%2fc~',mailboxUrl);
 assert.equal(encoded.search,'?opaque=a%20b%2fc~&token=synthetic-auth-only');
});
contract('BASE-SECRET-001', 'raw retrieval refuses authentication failures, redirects, wrong response URL or media type without retries',async()=>{
 for(const changed of [{status:401,type:'application/json'},{status:302},{redirected:true},{type:'text/plain'}]) {
  let calls=0;await assert.rejects(()=>resolveRawMime({rawUrl},{mailboxUrl,request:async url=>{calls++;return response(url,changed);}}),/^Error: mailbox-raw-/);assert.equal(calls,1);
 }
 let calls=0;await assert.rejects(()=>resolveRawMime({rawUrl},{mailboxUrl,request:async()=>{calls++;return response('https://foreign.example/raw');}}),/response-refused/);assert.equal(calls,1);
 calls=0;await assert.rejects(()=>resolveRawMime({rawUrl},{mailboxUrl,request:async()=>{calls++;throw Error('sensitive-provider-body-and-url');}}),error=>error.message==='mailbox-raw-fetch-failed');assert.equal(calls,1);
 const failedStream=new ReadableStream({start(controller){controller.error(Error('mailbox-raw-sensitive-provider-value'));}});
 await assert.rejects(()=>resolveRawMime({rawUrl},{mailboxUrl,request:async url=>response(url,{body:failedStream})}),error=>error.message==='mailbox-raw-read-failed');
});
contract('BASE-SECRET-001', 'raw retrieval enforces four MiB on declared length and streamed decoded bytes, cancelling oversized bodies',async()=>{
 const limit=4*1024*1024;
 await assert.rejects(()=>resolveRawMime({rawUrl},{mailboxUrl,request:async url=>response(url,{length:limit+1})}),/raw-size/);
 let cancelled=false;
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(limit));controller.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
 await assert.rejects(()=>resolveRawMime({rawUrl},{mailboxUrl,request:async url=>response(url,{body:stream})}),/raw-size/);assert.equal(cancelled,true);
 await assert.rejects(()=>resolveRawMime({rawUrl},{mailboxUrl,request:async url=>response(url,{body:''})}),/body-missing/);
});
contract('BASE-SECRET-001', 'raw receipt sources must be available and unambiguous; inline and supplied URL bytes must agree',async()=>{
 let calls=0;const request=async url=>{calls++;return response(url);};
 assert.equal(await resolveRawMime({rawMime:raw},{request}),raw);assert.equal(calls,0);
 assert.equal(await resolveRawMime({rawMime:raw,rawUrl},{mailboxUrl,request}),raw);assert.equal(calls,1);
 await assert.rejects(()=>resolveRawMime({rawMime:raw+'changed',rawUrl},{mailboxUrl,request}),/mime-ambiguous/);assert.equal(calls,2);
 await assert.rejects(()=>resolveRawMime({rawMime:raw,raw:'other'},{request}),/mime-ambiguous/);
 await assert.rejects(()=>resolveRawMime({excerpt:raw},{request}),/mime-unavailable/);
 assert.equal(calls,2);
});

contract('REQUEST-005','fresh correlated receipt retrieved once proves complete multipart acknowledgement facts',async()=>{
 const origin='https://dial-session-check.example.workers.dev',title=origin+' unique proof',hostName='QA host';
 const body={inviteeTimezone:'UTC',windows:[{date:'2099-10-09',startMinute:540,endMinute:600}],note:'QA note'};
 const text=`${title} ${hostName} UTC 2099-10-09 09:00–10:00 QA note`,html=`<table style="color:#176b5a"><tr><td>Dial ${text}</td></tr></table>`;
 const mime=`Content-Type: multipart/alternative; boundary="fresh"\r\n\r\n--fresh\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--fresh\r\nContent-Type: text/html\r\n\r\n${html}\r\n--fresh--\r\n`;
 const snapshot={ids:['historical'],at:'2026-10-08T00:00:00Z'},filter={recipient:'qa@example.test',origin,subject:'We received your time request for '+title};
 const receipt={id:'fresh',receivedAt:'2026-10-08T00:00:01Z',to:filter.recipient,subject:filter.subject,excerpt:text,rawUrl};
 const chosen=selectAcknowledgementReceipt([{...receipt,id:'historical'},receipt],receipt,snapshot,filter);let calls=0;
 const result=await resolveRawMime(chosen,{mailboxUrl,request:async url=>{calls++;return response(url,{body:mime});}});
 assert.equal(assertAcknowledgementMime(result,{title,hostName,request:body}).tableLayout,true);assert.equal(calls,1);
 assert.throws(()=>assertAcknowledgementMime(result,{title,hostName,request:{...body,inviteeTimezone:'Asia/Tokyo'}}),/fact-parity/);
});
