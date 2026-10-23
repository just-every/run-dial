import { initNoticeWire } from './notice-wire';
export async function noticeFixtures(url:URL,request:Request,db:D1Database,edge:D1Database){await initNoticeWire(edge);
 if(url.pathname.endsWith('/control')){const {name,value}=await request.json<{name:string;value:string}>();await edge.prepare('INSERT INTO notice_wire_controls VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').bind(name,value).run();return new Response(null,{status:204});}
 if(url.pathname.endsWith('/due')){await db.batch([db.prepare("UPDATE workspace_notice_deliveries SET next_attempt_at='2000-01-01T00:00:00Z' WHERE state='pending'"),db.prepare("UPDATE workspace_notice_destinations SET cooldown_until=NULL")]);return new Response(null,{status:204});}
 if(url.pathname.endsWith('/oauth-expired')){await db.prepare("UPDATE notice_oauth_states SET expires_at='2000-01-01T00:00:00Z'").run();return new Response(null,{status:204});}
 const tables=['workspace_notice_destinations','workspace_notice_deliveries','notice_erasure_requests'];const result:Record<string,unknown>={};for(const table of tables)result[table]=(await db.prepare(`SELECT * FROM ${table}`).all()).results;for(const table of ['notice_wire_calls','notice_wire_messages'])result[table]=(await edge.prepare(`SELECT * FROM ${table}`).all()).results;return Response.json(result);
}
