import assert from 'node:assert/strict';
export async function authorRoutingForm(page,width,data){
 await page.getByLabel('New form title',{exact:true}).fill(`Contact our team ${width}`);
 await page.getByLabel('New form slug',{exact:true}).fill(`contact-team-${width}`);
 await page.getByRole('button',{name:'Create routing form',exact:true}).click();
 await page.getByRole('button',{name:'Add question',exact:true}).click();
 const first=page.getByRole('group',{name:'Question 1',exact:true});
 await first.getByLabel('Label',{exact:true}).fill('What would you like to discuss?');
 await first.getByLabel('Required',{exact:true}).check();
 await page.getByRole('button',{name:'Add question',exact:true}).click();
 const second=page.getByRole('group',{name:'Question 2',exact:true});
 await second.getByLabel('Label',{exact:true}).fill('Your work email');
 await second.getByLabel(/^Question type/).selectOption('email');
 await second.getByLabel('Required',{exact:true}).check();
 await page.getByLabel('Published',{exact:true}).check();
 await page.getByRole('status').filter({hasText:'All changes saved'}).waitFor();
 const form=(await data('/api/app/routing-forms')).find(row=>row.slug===`contact-team-${width}`);
 assert.ok(form?.published);assert.deepEqual(form.questions.map(q=>[q.label,q.kind,q.required]),[['What would you like to discuss?','text',true],['Your work email','email',true]],'the operator creates and publishes ordered required questions through Settings');
 return form;
}
