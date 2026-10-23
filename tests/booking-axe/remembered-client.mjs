import assert from 'node:assert/strict';

export async function rememberedClientJourney({page,context,owner,origin,email,event,audit}) {
  await context.clearCookies();
  await page.goto(origin+'/book/dial-host/intro');
  await page.locator('.pb-slot-button:enabled').first().click();
  await page.getByLabel('Email',{exact:true}).fill(email);
  assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'','typing a known address reveals no saved details');
  assert.equal(await page.getByRole('button',{name:'Use saved details',exact:true}).count(),0);
  const sent=page.waitForResponse(response=>response.url().endsWith('/remember/request')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Email saved details',exact:true}).click();assert.equal((await sent).status(),202);
  await page.getByRole('region',{name:'Saved booking details'}).getByRole('status').waitFor();
  assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'');
  await audit('client-details-request');
  const status=async()=>{const response=await owner.request.get(origin+'/__fixtures/status');assert.equal(response.status(),200);return response.json();};
  const outbox=(await status()).delivery_outbox.find(row=>{const payload=JSON.parse(row.payload_json);return payload.clientRememberId&&payload.to===email;});
  assert.ok(outbox,'the request queued one email to the stored address');
  const payload=JSON.parse(outbox.payload_json),link=payload.text.match(/https?:\/\/\S+/)[0];
  for(let i=0;i<2;i++)assert.equal((await owner.request.post(origin+'/__fixtures/deliver',{data:{id:outbox.id}})).status(),200);
  assert.equal((await status()).fixture_mail.filter(row=>row.key===outbox.idempotency_key).length,1,'the synthetic mail edge received exactly one invitation');
  await page.goto(link);
  await page.locator('.pb-slot-button:enabled').first().click();
  await page.getByRole('button',{name:'Use saved details',exact:true}).click();
  await page.waitForFunction(()=>globalThis.document.querySelector('input[aria-label="Name"]')?.value==='Alex Rivera');
  assert.equal(await page.getByLabel('Email',{exact:true}).inputValue(),email);
  for(const question of event.questions)assert.equal(await page.getByLabel(question.label,{exact:true}).inputValue(),'Discuss the next project milestone.');
  assert.equal(await page.getByRole('button',{name:'Use saved details',exact:true}).count(),0);
  await audit('client-remembered-details');
  const iconOnly=await page.locator('button,a[href]').evaluateAll(nodes=>nodes.filter(node=>!node.textContent.trim()).map(node=>node.getAttribute('aria-label')));
  assert.deepEqual(iconOnly,[],'saved-details controls all have visible text');
}
