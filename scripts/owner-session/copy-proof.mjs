import {must} from './assert.mjs';
export function assertCopyReport({status,method,path,headers,body,report,clipboard,origin,eventId,expectedUrl}) {
 must(status===200&&method==='POST'&&path===`/api/app/event-types/${eventId}/copy-report`,'copy-report-native-endpoint');
 must(headers.origin===origin&&headers['x-dial-copy-report']==='1','copy-report-native-headers');
 must(body&&Object.keys(body).length===1&&body.url===expectedUrl,'copy-report-canonical-body');
 must(clipboard===expectedUrl&&report?.canonicalUrl===expectedUrl&&report.eventTypeId===eventId,'copy-report-url-mismatch');
 must(typeof report.acceptedAt==='string'&&Number.isFinite(Date.parse(report.acceptedAt)),'copy-report-time-invalid');
 return {eventTypeId:eventId,canonicalUrl:expectedUrl,acceptedAt:report.acceptedAt};
}
