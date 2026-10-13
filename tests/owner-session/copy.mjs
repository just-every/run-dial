import assert from 'node:assert/strict';
import {contract} from '../contract.mjs';
import {assertCopyReport} from '../../scripts/owner-session/copy-proof.mjs';
contract('EVENT-001','owner proof requires native clipboard URL and authenticated accepted copy report',()=>{
 const origin='https://dial.example',eventId='event',expectedUrl=origin+'/book/qa/event';
 const value={status:200,method:'POST',path:'/api/app/event-types/event/copy-report',headers:{origin,'x-dial-copy-report':'1'},body:{url:expectedUrl},report:{eventTypeId:eventId,canonicalUrl:expectedUrl,acceptedAt:'2026-10-08T00:00:00Z'},clipboard:expectedUrl,origin,eventId,expectedUrl};
 assert.equal(assertCopyReport(value).canonicalUrl,expectedUrl);
 for(const change of [x=>{x.status=403;},x=>{x.clipboard+='?wrong';},x=>{x.report.acceptedAt=null;},x=>{x.report.canonicalUrl+='?old';},x=>{delete x.headers.origin;},x=>{x.headers['x-dial-copy-report']='0';},x=>{x.body.extra=true;},x=>{x.report.eventTypeId='another';},x=>{x.method='GET';}]){const bad=structuredClone(value);change(bad);assert.throws(()=>assertCopyReport(bad));}
});
