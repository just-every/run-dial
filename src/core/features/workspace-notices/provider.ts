import { NoticeFailure } from './types';
export function workflowUrl(raw:string){let url:URL;try{url=new URL(raw);}catch{throw new NoticeFailure('teams_workflow_url_required',400);}if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port||!(/^[a-z0-9-]+\.environment\.api\.powerplatform\.com$/i.test(url.hostname)||/^[a-z0-9.-]+\.logic\.azure\.com$/i.test(url.hostname)))throw new NoticeFailure('teams_workflow_url_required',400);return url;}
export type SendResult={kind:'sent';ref:string|null}|{kind:'throttled';seconds:number}|{kind:'refused';reason:string}|{kind:'unknown';reason:string};
export async function sendNotice(transport:typeof fetch,provider:'slack'|'teams',credential:string,target:string,text:string):Promise<SendResult>{
 let response:Response;try{response=await transport(provider==='slack'?'https://slack.com/api/chat.postMessage':credential,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json',...(provider==='slack'?{authorization:'Bearer '+credential}:{})},body:JSON.stringify(provider==='slack'?{channel:target,text,parse:'none',unfurl_links:false,unfurl_media:false}:{type:'message',attachments:[{contentType:'application/vnd.microsoft.card.adaptive',contentUrl:null,content:{$schema:'http://adaptivecards.io/schemas/adaptive-card.json',type:'AdaptiveCard',version:'1.2',body:[{type:'TextBlock',text,wrap:true}]}}]})});}catch{return {kind:'unknown',reason:'delivery_outcome_unknown'};}
 if(response.status===429){const seconds=Number(response.headers.get('retry-after'));return {kind:'throttled',seconds:Number.isFinite(seconds)&&seconds>=0?seconds:60};}
 if(provider==='teams'){if(response.ok)return {kind:'sent',ref:null};if(response.status>=400&&response.status<500)return {kind:'refused',reason:'teams_webhook_rejected'};return {kind:'unknown',reason:'delivery_outcome_unknown'};}
 if(response.status>=500)return {kind:'unknown',reason:'delivery_outcome_unknown'};
 let data:Record<string,unknown>;try{data=await response.json();}catch{return {kind:'unknown',reason:'delivery_outcome_unknown'};}
 if(data.ok===true&&data.channel===target&&typeof data.ts==='string')return {kind:'sent',ref:data.ts};
 const code=String(data.error??'');if(['token_revoked','account_inactive','invalid_auth'].includes(code))return {kind:'refused',reason:code};
 if(data.ok===false&&['channel_not_found','not_in_channel','missing_scope','is_archived'].includes(code))return {kind:'refused',reason:code};
 return {kind:'unknown',reason:'delivery_outcome_unknown'};
}
export const cleanSummary=(text:string)=>text.replace(/[&<>[\]()*_`\\]/gu,' ').replace(/[\r\n]/gu,' ').slice(0,300);
