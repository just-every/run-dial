import type { PublicAnalytics } from "./types";

/** The opaque sandbox keeps vendor code away from booking DOM, credentials and query strings. */
export function analyticsFrame(tags: PublicAnalytics) {
  const configuration=JSON.stringify(tags).replaceAll("<","\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Booking measurement</title></head><body><script>
const tags=${configuration};
let initialized=false;
const send=value=>parent.postMessage(value,'*');
const page=value=>{try{const url=new URL(value);return url.origin===location.origin&&!url.search&&!url.hash?url.href:null;}catch{return null;}};
const script=src=>{const node=document.createElement('script');node.async=true;node.src=src;node.referrerPolicy='no-referrer';document.head.appendChild(node);};
function initialize(data){
 const location=page(data.pageLocation);if(!location||typeof data.clientId!=='string')return;
 window.dataLayer=[];
 const google=[tags.ga4MeasurementId,tags.googleAds?.conversionId].filter(Boolean);
 if(google.length){window.gtag=function(){dataLayer.push(arguments);};gtag('js',new Date());for(const id of google)gtag('config',id,{send_page_view:false,page_location:location,page_referrer:'',client_id:data.clientId,allow_google_signals:false,allow_ad_personalization_signals:false});script('https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(google[0]));}
 if(tags.gtmContainerId){dataLayer.push({'gtm.start':Date.now(),event:'gtm.js'});script('https://www.googletagmanager.com/gtm.js?id='+encodeURIComponent(tags.gtmContainerId));}
 if(tags.metaPixelId){const f=window.fbq=function(){if(f.callMethod)f.callMethod.apply(f,arguments);else f.queue.push(arguments);};f.queue=[];f.loaded=true;f.version='2.0';f.push=f;fbq('set','autoConfig',false,tags.metaPixelId);fbq('init',tags.metaPixelId);script('https://connect.facebook.net/en_US/fbevents.js');}
 if(tags.linkedInPartnerId){window._linkedin_partner_id=tags.linkedInPartnerId;window._linkedin_data_partner_ids=[tags.linkedInPartnerId];window.lintrk=function(){lintrk.q.push(arguments);};lintrk.q=[];script('https://snap.licdn.com/li.lms-analytics/insight.min.js');}
 initialized=true;send({type:'dial:analytics-initialized'});
}
async function event(data){
 const location=page(data.pageLocation);if(!location||!['page_view','slot_selected','booking_confirmed'].includes(data.event)||typeof data.identity!=='string'||data.identity.length>500)return;
 const fields={page_location:location,page_referrer:'',event_id:data.identity};
 if(tags.gtmContainerId)dataLayer.push({event:data.event,...fields});
 if(tags.metaPixelId)fbq('trackCustom',data.event,{page_location:location},{eventID:data.identity});
 if(tags.linkedInPartnerId)lintrk('track',{event_name:data.event,event_id:data.identity});
 const commands=[];if(tags.ga4MeasurementId)commands.push([data.event,[tags.ga4MeasurementId]]);
 if(data.event==='booking_confirmed'&&tags.googleAds)commands.push(['conversion',[tags.googleAds.conversionId+'/'+tags.googleAds.conversionLabel]]);
 await Promise.all(commands.map(([name,destinations])=>new Promise(done=>{const timer=setTimeout(done,1000);gtag('event',name,{...fields,send_to:destinations,...(data.event==='booking_confirmed'?{transaction_id:data.identity}:{}),event_timeout:900,event_callback:()=>{clearTimeout(timer);done();}});})));send({type:'dial:analytics-delivered',requestId:data.requestId});
}
addEventListener('message',message=>{if(message.source!==parent||!message.data||typeof message.data!=='object')return;const data=message.data;if(data.type==='dial:analytics-init'&&!initialized)initialize(data);else if(data.type==='dial:analytics-event'&&initialized)void event(data);});
send({type:'dial:analytics-frame-ready'});
</script></body></html>`;
}
