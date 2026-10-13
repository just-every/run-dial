import {must} from './assert.mjs';
import {receiptRawMime} from './mime-proof.mjs';

const maxBytes=4*1024*1024;
const rawReadErrors=new Set(['mailbox-raw-response-refused','mailbox-raw-content-type','mailbox-raw-size','mailbox-raw-body-missing','mailbox-raw-body-invalid','mailbox-raw-encoding']);
export function rawMailTarget(rawUrl,mailboxUrl) {
 let target,endpoint;
 try {endpoint=new URL(mailboxUrl);must(typeof rawUrl==='string'&&rawUrl.length>0&&rawUrl.trim()===rawUrl,'mailbox-raw-url-invalid');target=new URL(rawUrl,endpoint.origin);}catch{throw new Error('mailbox-raw-url-invalid');}
 must(typeof rawUrl==='string'&&target.protocol==='https:'&&endpoint.protocol==='https:'&&!target.username&&!target.password&&!endpoint.username&&!endpoint.password&&!target.hash&&!endpoint.hash&&target.origin===endpoint.origin,'mailbox-raw-origin-refused');
 const credentials=endpoint.searchParams.getAll('token'),existing=target.searchParams.getAll('token');
 must(credentials.length===1&&credentials[0].length>0,'mailbox-raw-auth-unavailable');
 must(existing.length<=1&&(existing.length===0||existing[0]===credentials[0]),'mailbox-raw-auth-conflict');
 // The service supplied this exact resource path. Only its established same-
 // origin authentication parameter is transferred; no endpoint is invented.
 if(existing.length===0)target.search=(target.search?target.search+'&':'?')+'token='+encodeURIComponent(credentials[0]);
 return target;
}

async function rawBody(response,target) {
 const discard=async()=>{try{await response.body?.cancel();}catch{/* No body or provider error is logged. */}};
 if(response.status!==200||response.redirected||response.url!==target.href){await discard();throw new Error('mailbox-raw-response-refused');}
 if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='message/rfc822'){await discard();throw new Error('mailbox-raw-content-type');}
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes)){await discard();throw new Error('mailbox-raw-size');}
 must(response.body,'mailbox-raw-body-missing');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try {
  for(;;) {
   const {done,value}=await reader.read();if(done)break;
   must(value instanceof Uint8Array,'mailbox-raw-body-invalid');size+=value.byteLength;
   must(size<=maxBytes,'mailbox-raw-size');chunks.push(value);
  }
  must(size>0,'mailbox-raw-body-missing');
  try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size));}
  catch{throw new Error('mailbox-raw-encoding');}
 } finally {try{await reader.cancel();}catch{/* Suppress transport details. */}reader.releaseLock();}
}

export async function resolveRawMime(receipt,{mailboxUrl,request=fetch}={}) {
 const inlinePresent=['rawMime','rawMIME','raw','rawContent'].some(key=>Object.hasOwn(receipt,key));
 const inline=inlinePresent?receiptRawMime(receipt):undefined;
 if(inline!==undefined)must(Buffer.byteLength(inline)<=maxBytes,'mailbox-raw-size');
 if(!Object.hasOwn(receipt,'rawUrl')){must(inline!==undefined,'mailbox-raw-mime-unavailable');return inline;}
 const target=rawMailTarget(receipt.rawUrl,mailboxUrl);let response;
 try {response=await request(target.href,{method:'GET',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',headers:{Accept:'message/rfc822'},signal:AbortSignal.timeout(20000)});}
 catch {throw new Error('mailbox-raw-fetch-failed');}
 let fetched;
 try {fetched=await rawBody(response,target);}
 catch(error) {throw new Error(rawReadErrors.has(error?.message)?error.message:'mailbox-raw-read-failed');}
 must(inline===undefined||inline===fetched,'mailbox-raw-mime-ambiguous');return fetched;
}
