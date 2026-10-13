import {must} from './assert.mjs';
export function matches(x,s,{recipient,subject,origin,marker,originInSubject=false}) {
 const recipients=String(x.to??x.toHeader??'').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/g)??[];
 return typeof x.id==='string'&&!s.ids.includes(x.id)&&Number.isFinite(Date.parse(x.receivedAt))&&Date.parse(x.receivedAt)>=Date.parse(s.at)-1000&&recipients.includes(recipient.toLowerCase())&&x.subject===subject&&String(originInSubject?x.subject:x.excerpt??'').includes(origin)&&(!marker||String(x.excerpt??'').includes(marker));
}
export function selectMagicReceipt(receipts,s,recipient,origin) {
 const found=receipts.flatMap(x=>magicCandidates(x,s,recipient,origin));must(found.length<=1,'ambiguous-signin-receipt-no-resend');return found[0];
}
export function magicCandidates(x,s,recipient,origin) {
 if(!matches(x,s,{recipient,subject:'Your sign-in link for Dial',origin}))return [];
 const found=[];for(const m of String(x.excerpt).matchAll(/https:\/\/[^\s<>"']+/g)){let u;try{u=new URL(m[0]);}catch{continue;}if(u.origin===origin&&u.pathname==='/auth/confirm'&&u.searchParams.get('token')?.length>=32)found.push({x,u});}return found;
}
export function selectAcknowledgementReceipt(receipts,recorded,snapshot,filter) {
 const rows=receipts.filter(row=>matches(row,snapshot,filter));
 must(rows.length===1&&rows[0].id===recorded.id&&rows[0].receivedAt===recorded.receivedAt,'acknowledgement-receipt-identity');return rows[0];
}
