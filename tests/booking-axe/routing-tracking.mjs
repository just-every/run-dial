import assert from 'node:assert/strict';

export async function routingTracking(context,origin){
 const requests=[];
 await context.route('https://**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='studio.example.test'){await route.fallback();return;}
  requests.push({url:url.href,body:route.request().postData()});
  if(url.hostname==='www.googletagmanager.com'&&url.pathname==='/gtag/js'){
   await route.fulfill({contentType:'application/javascript',body:`(()=>{const q=window.dataLayer;const send=values=>{const [kind,name,params]=Array.from(values);if(kind!=='event')return;const url=new URL('https://www.google-analytics.com/g/collect');url.searchParams.set('en',name);url.searchParams.set('dl',params.page_location);url.searchParams.set('id',params.event_id);fetch(url,{method:'POST'}).then(()=>params.event_callback?.());};q.forEach(send);const push=q.push.bind(q);q.push=(...values)=>{values.forEach(send);return push(...values);};})();`});return;
  }
  assert.equal(url.hostname,'www.google-analytics.com');await route.fulfill({status:204});
 });
 const events=()=>requests.filter(row=>new URL(row.url).hostname==='www.google-analytics.com').map(row=>new URL(row.url).searchParams.get('en'));
 return {requests,events,async waitFor(name){for(let n=0;n<80&&!events().includes(name);n++)await new Promise(resolve=>setTimeout(resolve,100));assert.ok(events().includes(name));},assertPrivate(){for(const row of requests.filter(row=>new URL(row.url).hostname==='www.google-analytics.com')){const url=new URL(row.url);assert.ok(url.searchParams.get('dl').startsWith(origin));assert.equal(new URL(url.searchParams.get('dl')).search,'');for(const excluded of ['Taylor','Private planning','routeToken','nonce','example.test%40'])assert.ok(!JSON.stringify(row).includes(excluded));}}};
}
