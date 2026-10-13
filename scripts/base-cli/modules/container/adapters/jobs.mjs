import { randomUUID } from 'node:crypto';
function jsonBody(body,seen=new Set()){
 if(body===null||typeof body==='string'||typeof body==='boolean'||(typeof body==='number'&&Number.isFinite(body)))return;
 if(typeof body!=='object'||seen.has(body)||(!Array.isArray(body)&&![Object.prototype,null].includes(Object.getPrototypeOf(body))))throw new Error('Queue body must be JSON');
 seen.add(body);for(const value of Object.values(body))jsonBody(value,seen);seen.delete(body);
}
export class Jobs {
 constructor(sqlite, queue, { maxRetries = 3, batchSize = 10, visibilitySeconds = 60 } = {}) {
  this.sqlite = sqlite; this.queue = queue; this.maxRetries = maxRetries; this.batchSize = batchSize; this.visibilitySeconds = visibilitySeconds;
  sqlite.exec("CREATE TABLE IF NOT EXISTS platform_jobs (id TEXT PRIMARY KEY, queue TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','claimed','dead')), attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL, claimed_until INTEGER, token TEXT)");
 }
 record(body,{delaySeconds=0,contentType='json'}={}){
  jsonBody(body);if(contentType!=='json'||!Number.isInteger(delaySeconds)||delaySeconds<0)throw new Error('Unsupported queue options');return[randomUUID(),this.queue,JSON.stringify(body),Date.now()+delaySeconds*1000];
 }
 insert(record){this.sqlite.prepare("INSERT INTO platform_jobs(id,queue,body,state,available_at) VALUES(?,?,?,'pending',?)").run(...record);}
 async send(body,options){this.insert(this.record(body,options));}
 async sendBatch(messages) {const records=messages.map(message=>this.record(message.body,message));this.sqlite.exec('BEGIN');try{records.forEach(record=>this.insert(record));this.sqlite.exec('COMMIT');}catch(cause){this.sqlite.exec('ROLLBACK');throw cause;}}
 async drain(consumer, bindings, execution) {
  if (this.running) return; this.running = true;
  try {
   const now = Date.now(); this.sqlite.prepare("UPDATE platform_jobs SET state='pending',token=NULL WHERE queue=? AND state='claimed' AND claimed_until<=?").run(this.queue, now);
   const rows = this.sqlite.prepare("SELECT * FROM platform_jobs WHERE queue=? AND state='pending' AND available_at<=? ORDER BY available_at LIMIT ?").all(this.queue, now, this.batchSize);
   const messages = [];
   for (const row of rows) {
    const token = randomUUID(); const claim = this.sqlite.prepare("UPDATE platform_jobs SET state='claimed',token=?,attempts=attempts+1,claimed_until=? WHERE id=? AND state='pending'").run(token, now + this.visibilitySeconds * 1000, row.id);
    if (!claim.changes) continue;
    let disposition;
    const message = { id: row.id, timestamp: new Date(row.available_at), body: JSON.parse(row.body), attempts: row.attempts + 1, ack() { disposition = 'ack'; }, retry(options = {}) { disposition = options; } };
    messages.push({ row, token, message, disposition: () => disposition });
   }
   if (!messages.length) return;
   let failed = false;
   try { await consumer({ queue: this.queue, messages: messages.map(x => x.message), ackAll() { messages.forEach(x => x.message.ack()); }, retryAll(options) { messages.forEach(x => x.message.retry(options)); } }, bindings, execution); }
   catch { failed = true; }
   for (const item of messages) {
    const disposition = item.disposition();
    if (disposition === 'ack' || (!failed && disposition === undefined)) this.sqlite.prepare('DELETE FROM platform_jobs WHERE id=? AND token=?').run(item.row.id, item.token);
    else {
     const dead = item.message.attempts > this.maxRetries;
     const delay = disposition?.delaySeconds ?? Math.min(3600, 2 ** item.message.attempts);
     this.sqlite.prepare('UPDATE platform_jobs SET state=?,available_at=?,claimed_until=NULL,token=NULL WHERE id=? AND token=?').run(dead ? 'dead' : 'pending', Date.now() + delay * 1000, item.row.id, item.token);
    }
   }
  } finally { this.running = false; }
 }
 dead() { return this.sqlite.prepare("SELECT count(*) AS n FROM platform_jobs WHERE queue=? AND state='dead'").get(this.queue).n; }
}
