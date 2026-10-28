import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { genericFiles } from '../tests/move-in/scheduler-fixtures.mjs';

export async function schedulerJourney({page,context,origin,audit}){
 assert.equal((await context.request.post(origin+'/__fixtures/import-empty')).status(),200);
 await page.goto(origin+'/app/settings#move-in');
 const card=page.locator('#move-in');
 await card.getByText('Capture from a scheduler API',{exact:true}).click();
 await expect(card.getByLabel('Scheduler access token')).toHaveAttribute('type','password');
 await expect(card.getByRole('button',{name:'Capture source data',exact:true})).toBeDisabled();
 await audit('scheduler-source');
 for(const calendar of [false,true]){
  if(calendar){assert.equal((await context.request.post(origin+'/__fixtures/import-empty')).status(),200);await page.reload();}
  const files=genericFiles(calendar),input=card.getByLabel('Saved response files');await expect(input).toBeEnabled();
  await input.setInputFiles(files.map(file=>({name:file.name,mimeType:file.name.endsWith('.json')?'application/json':file.name.endsWith('.ics')?'text/calendar':'text/csv',buffer:file.bytes})));
  const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/app/move-in/preview'&&response.request().method()==='POST');
  await card.getByRole('button',{name:'Preview saved data',exact:true}).click();
  const preview=await response,payload=await preview.json();assert.equal(preview.status(),200,payload.error?.message??'Source preview must succeed.');
  await card.getByRole('button',{name:'Download JSON report',exact:true}).waitFor();
  await expect(card.getByText(calendar?'X-OLD-REMINDER':'sms_rule',{exact:true})).toBeVisible();
  await expect(card.getByText('payment_rule',{exact:true})).toBeVisible();
  await expect(card.getByText(/Bookings: 1 read = 1 to import/u)).toBeVisible();
  await audit(calendar?'calendar-preview':'csv-preview');
  await card.getByLabel('I acknowledge all listed losses, rejected overlaps and changed values.').check();
  await card.getByRole('button',{name:'Apply reviewed import',exact:true}).click();
  await card.getByRole('button',{name:'Continue import',exact:true}).waitFor();
  for(let n=0;n<30&&await card.getByRole('button',{name:'Continue import',exact:true}).count();n++){
   await card.getByRole('button',{name:'Continue import',exact:true}).click();await card.getByText('Working on this bounded batch…').waitFor({state:'hidden'});
  }
  await card.getByRole('button',{name:'Undo import',exact:true}).waitFor();
  await audit(calendar?'calendar-applied':'csv-applied');
  const menu=page.getByRole('button',{name:'Menu',exact:true});if(await menu.isVisible())await menu.click();
  await page.getByRole('navigation',{name:'Operator navigation'}).getByRole('link',{name:'Bookings',exact:true}).click();
  await page.getByText('Ada Example',{exact:true}).first().waitFor();await page.getByText('Imported',{exact:true}).first().waitFor();await audit(calendar?'calendar-booking':'csv-booking');
  const status=await(await context.request.get(origin+'/__fixtures/import-status')).json();assert.equal(status.delivery_outbox.length,0);assert.equal(status.fixture_mail.length,0);assert.equal(status.fixture_events.length,0);
  await page.goto(origin+'/app/settings#move-in');
  await card.getByRole('button',{name:/completed ·/u}).first().click();
  page.once('dialog',dialog=>dialog.accept());await card.getByRole('button',{name:'Undo import',exact:true}).click();await card.getByText('Working on this bounded batch…').waitFor({state:'hidden'});
  for(let n=0;n<30&&await card.getByRole('button',{name:'Continue import',exact:true}).count();n++){
   await card.getByRole('button',{name:'Continue import',exact:true}).click();await card.getByText('Working on this bounded batch…').waitFor({state:'hidden'});
  }
  await expect(card.getByRole('status').filter({hasText:'undone:'})).toHaveCount(1);await audit(calendar?'calendar-undone':'csv-undone');
  assert.deepEqual(await(await context.request.get(origin+'/api/app/bookings')).json(),[]);
 }
 for(const slug of ['importing','importing-schedulers','importing-templates']){
  await page.goto(`${origin}/docs/${slug}`);await page.getByRole('heading',{level:1}).waitFor();await audit(`guide-${slug}`);
 }
}
