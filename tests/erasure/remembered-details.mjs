import assert from 'node:assert/strict';

export async function rememberedDetails(rt,{email,name,phone,phoneKey,eventId}) {
  const base='/api/public/book/dial-host/intro/remember';
  const call=async(path,body,status)=>{
    const response=await rt.api(path,{method:'POST',headers:{cookie:'','content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,status,'remembered-details public door');return response.json();
  };
  const known=await call(base+'/request',{email},202);
  const unknown=await call(base+'/request',{email:'synthetic-dial-1009@example.test'},202);
  assert.deepEqual(known,unknown,'a typed email never discloses whether a client exists');
  await call(base+'/request',{email:email.toUpperCase()},202);
  const mail=()=>rt.db.prepare("SELECT payload_json FROM delivery_outbox WHERE json_extract(payload_json,'$.clientRememberId') IS NOT NULL ORDER BY created_at,id").all();
  const firstMail=(await mail()).results;assert.equal(firstMail.length,1,'repeating within a minute sends no second mail');
  const payload=JSON.parse(firstMail[0].payload_json);
  const history=await rt.data('/api/app/clients/history?'+new URLSearchParams({email}));
  assert.ok(history.bookings.some(booking=>booking.email===payload.to),'only an address stored on the client receives the link');
  const token=new URL(payload.text.match(/https?:\/\/\S+/)[0]).searchParams.get('remember');
  const links=async()=>(await rt.db.prepare('SELECT * FROM client_remember_links ORDER BY id').all()).results;
  assert.equal(JSON.stringify(await links()).includes(token),false,'the link table stores no raw capability');
  const refused=async(path,candidate)=>{
    const before={links:await links(),mail:(await mail()).results};
    await call(path,{token:candidate},404);
    assert.deepEqual({links:await links(),mail:(await mail()).results},before,'invalid, foreign, expired and replayed capabilities write no client or mail state');
  };
  await refused(base+'/redeem',(token[0]==='a'?'b':'a')+token.slice(1));
  const foreign=(await rt.data('/api/app/event-types')).find(event=>event.id!==eventId&&event.status==='published');
  assert.ok(foreign,'the foreign capability probe uses a different existing event');
  await refused(`/api/public/book/dial-host/${foreign.slug}/remember/redeem`,token);
  const expiry=(await links())[0].expires_at;
  await rt.db.prepare("UPDATE client_remember_links SET expires_at='2000-01-01T00:00:00.000Z'").run();
  await refused(base+'/redeem',token);
  await rt.db.prepare('UPDATE client_remember_links SET expires_at=?').bind(expiry).run();
  const details=await call(base+'/redeem',{token},200);
  assert.equal(details.name,name);assert.equal(details.phone,phone);assert.equal(details.answers[phoneKey],phone);
  assert.deepEqual(Object.keys(details).sort(),['answers','email','name','phone']);
  await refused(base+'/redeem',token);
  await rt.db.prepare("UPDATE client_remember_links SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 minutes')").run();
  await call(base+'/request',{email},202);
  const pending=(await mail()).results.map(row=>JSON.parse(row.payload_json)).at(-1);
  return {token:new URL(pending.text.match(/https?:\/\/\S+/)[0]).searchParams.get('remember'),base};
}
