import {must} from './assert.mjs';

function entity(raw) {
 const split=raw.search(/\r?\n\r?\n/);must(split>=0,'mime-headers-missing');
 const headerText=raw.slice(0,split).replace(/\r?\n[ \t]+/g,' '),headers={};
 for(const line of headerText.split(/\r?\n/)) {
  const at=line.indexOf(':');must(at>0,'mime-header-invalid');const key=line.slice(0,at).toLowerCase();
  must(!Object.hasOwn(headers,key)||!['content-type','content-transfer-encoding'].includes(key),'mime-ambiguous-header');headers[key]=line.slice(at+1).trim();
 }
 const body=raw.slice(split).replace(/^\r?\n\r?\n/,'');return {headers,body};
}
function decoded(body,encoding='7bit') {
 if(encoding.toLowerCase()==='base64') {must(/^[A-Za-z0-9+/=\r\n\t ]*$/.test(body),'mime-base64-invalid');return Buffer.from(body.replace(/\s/g,''),'base64').toString('utf8');}
 if(encoding.toLowerCase()==='quoted-printable')return Buffer.from(body.replace(/=\r?\n/g,'').replace(/=([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))),'binary').toString('utf8');
 must(['7bit','8bit','binary'].includes(encoding.toLowerCase()),'mime-encoding-unsupported');return body;
}
export function mimeParts(raw,depth=0) {
 must(typeof raw==='string'&&Buffer.byteLength(raw)<=4*1024*1024&&depth<8,'mime-size-or-depth');
 const {headers,body}=entity(raw),type=headers['content-type']??'text/plain';
 if(/^multipart\//i.test(type)) {
  const boundary=type.match(/boundary\s*=\s*(?:"([^"\r\n]+)"|([^;\s]+))/i);must(boundary,'mime-boundary-required');
  const marker='--'+(boundary[1]??boundary[2]),lines=body.split(/\r?\n/),parts=[];let current=null,closed=false;
  for(const line of lines) {
   if(line===marker||line===marker+'--') {if(current!==null)parts.push(...mimeParts(current.join('\r\n'),depth+1));current=[];if(line.endsWith('--')){closed=true;break;}}
   else if(current!==null)current.push(line);
  }
  must(closed&&parts.length>0,'mime-multipart-incomplete');return parts;
 }
 return [{type:type.split(';')[0].trim().toLowerCase(),body:decoded(body,headers['content-transfer-encoding'])}];
}
export function receiptRawMime(receipt) {
 const candidates=['rawMime','rawMIME','raw','rawContent'].map(key=>receipt[key]).filter(value=>typeof value==='string'&&value.length>0);
 must(candidates.length>0,'mailbox-raw-mime-unavailable');must(new Set(candidates).size===1,'mailbox-raw-mime-ambiguous');return candidates[0];
}
export function assertAcknowledgementMime(raw,{title,hostName,request}) {
 const parts=mimeParts(raw),texts=parts.filter(part=>part.type==='text/plain'),htmls=parts.filter(part=>part.type==='text/html');
 must(texts.length===1&&htmls.length===1,'acknowledgement-multipart-alternative-required');
 const text=texts[0].body,html=htmls[0].body;
 const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
 const facts=[title,hostName];
 if(request){facts.push(request.inviteeTimezone,...request.windows.map(window=>`${window.date} ${String(Math.floor(window.startMinute/60)).padStart(2,'0')}:${String(window.startMinute%60).padStart(2,'0')}–${String(Math.floor(window.endMinute/60)).padStart(2,'0')}:${String(window.endMinute%60).padStart(2,'0')}`));if(request.note)facts.push(request.note);}
 for(const value of facts)must(typeof value==='string'&&text.includes(value)&&html.includes(escape(value)),'acknowledgement-fact-parity');
 must(/<table\b/i.test(html)&&/style\s*=\s*["']/i.test(html)&&/Dial/.test(html),'acknowledgement-dial-layout');
 must(!/<(?:script|img|link|iframe|object|embed|svg|video|audio|source)\b|\bbackground\s*=|@import|@font-face|url\s*\(/i.test(html),'acknowledgement-remote-resource');
 const links=[...text.matchAll(/https:\/\/[^\s<>"']+/g)].map(match=>match[0].replace(/[.,;)]+$/,''));
 for(const link of links)must(html.includes(escape(link)),'acknowledgement-link-parity');
 return {parts:['text/plain','text/html'],tableLayout:true,inlineStyles:true,remoteResources:0,linksChecked:links.length};
}
export function assertSigninMime(raw,link) {
 const parts=mimeParts(raw),texts=parts.filter(part=>part.type==='text/plain'),htmls=parts.filter(part=>part.type==='text/html');
 must(texts.length===1&&htmls.length===1,'signin-multipart-alternative-required');
 const escaped=link.replaceAll('&','&amp;').replaceAll('"','&quot;');
 must(texts[0].body.includes(link)&&htmls[0].body.includes(escaped),'signin-mime-link-mismatch');
 must(texts[0].body.includes('Confirm')&&htmls[0].body.includes('Confirm sign-in to Dial'),'signin-mime-branding');
 return {parts:['text/plain','text/html'],branding:'Dial',linkMatched:true};
}
export function assertConfirmationMime(raw,{title,manageUrl}) {
 const parts=mimeParts(raw),texts=parts.filter(part=>part.type==='text/plain'),htmls=parts.filter(part=>part.type==='text/html'),calendars=parts.filter(part=>part.type==='text/calendar');
 must(texts.length===1&&htmls.length===1,'confirmation-multipart-alternative-required');
 must(calendars.length===1&&/BEGIN:VCALENDAR/.test(calendars[0].body)&&/METHOD:REQUEST/.test(calendars[0].body)&&!calendars[0].body.includes(manageUrl),'confirmation-ics-attachment');
 must(texts[0].body.includes(title)&&texts[0].body.includes(manageUrl)&&htmls[0].body.includes(manageUrl.replaceAll('&','&amp;')),'confirmation-manage-link-parity');
 return {parts:['text/plain','text/html','text/calendar'],manageLinkInBoth:true,icsAttached:true};
}
