/** Synthetic Slack and Teams HTTP edges. No send dedupe: a repeated POST is a second message. */
export const isNoticeHost=(host:string)=>host==='slack.com'||host.endsWith('.environment.api.powerplatform.com')||host.endsWith('.logic.azure.com');
export async function initNoticeWire(db:D1Database){await db.batch([db.prepare('CREATE TABLE IF NOT EXISTS notice_wire_controls(name TEXT PRIMARY KEY,value TEXT)'),db.prepare('CREATE TABLE IF NOT EXISTS notice_wire_calls(id INTEGER PRIMARY KEY,provider TEXT,path TEXT,body TEXT)'),db.prepare('CREATE TABLE IF NOT EXISTS notice_wire_messages(id TEXT PRIMARY KEY,provider TEXT,channel TEXT,body TEXT,deleted INTEGER NOT NULL DEFAULT 0)')]);}
export async function noticeWire(db:D1Database,url:URL,init:RequestInit){await initNoticeWire(db);const provider=url.hostname==='slack.com'?'slack':'teams',path=url.pathname,body=path.endsWith('oauth.v2.access')?{}:JSON.parse(String(init.body??'{}'));
 const control=async(name:string)=>(await db.prepare('SELECT value FROM notice_wire_controls WHERE name=?').bind(name).first<{value:string}>())?.value;
 await db.prepare('INSERT INTO notice_wire_calls(provider,path,body) VALUES(?,?,?)').bind(provider,path,JSON.stringify(body)).run();
 if(path.endsWith('oauth.v2.access'))return Response.json({ok:true,access_token:'synthetic-dial-600',token_type:'bot',scope:'chat:write,im:write',team:{id:'synthetic-dial-601'},bot_user_id:'synthetic-dial-602',authed_user:{id:'synthetic-dial-603'}});
 if(provider==='slack'&&new Headers(init.headers).get('authorization')!=='Bearer synthetic-dial-600')return Response.json({ok:false,error:'invalid_auth'});
 if(path.endsWith('conversations.open'))return Response.json({ok:true,channel:{id:'synthetic-dial-604'}});
 if(path.endsWith('chat.delete')){const result=await db.prepare('UPDATE notice_wire_messages SET deleted=1 WHERE id=? AND channel=? AND deleted=0').bind(body.ts,body.channel).run();return Response.json(result.meta.changes?{ok:true,channel:body.channel,ts:body.ts}:{ok:false,error:'message_not_found'});}
 if(await control(provider+'-revoked'))return provider==='slack'?Response.json({ok:false,error:'token_revoked'}):new Response(null,{status:410});
 if(await control(provider+'-rate')){await db.prepare('DELETE FROM notice_wire_controls WHERE name=?').bind(provider+'-rate').run();return new Response(null,{status:429,headers:{'retry-after':'60'}});}
 const id='synthetic-dial-'+crypto.randomUUID(),channel=provider==='slack'?body.channel:'workflow';await db.prepare('INSERT INTO notice_wire_messages(id,provider,channel,body) VALUES(?,?,?,?)').bind(id,provider,channel,JSON.stringify(body)).run();
 if(await control(provider+'-lost'))throw Error('synthetic response lost after message acceptance');return provider==='slack'?Response.json({ok:true,channel,ts:id}):new Response(null,{status:202});
}
