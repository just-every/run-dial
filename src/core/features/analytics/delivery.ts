import { unseal } from "../../platform/crypto/sealed";
import { AnalyticsFailure, type ConversionRecord } from "./types";
import { uploadConversion } from "./provider";

const delays = [60000,180000,480000,1080000,1800000];
const available = `archive_historical=0 AND EXISTS(SELECT 1 FROM analytics_connections c WHERE c.provider=analytics_deliveries.provider AND c.generation=analytics_deliveries.generation AND c.status='connected' AND c.credential_ciphertext IS NOT NULL)
  AND EXISTS(SELECT 1 FROM bookings b WHERE b.id=analytics_deliveries.booking_id AND NOT EXISTS(SELECT 1 FROM person_erasure_locks l WHERE l.email=b.invitee_email_folded))`;

export class AnalyticsDelivery {
  constructor(private readonly db:D1Database,private readonly secret:string,private readonly transport:typeof fetch) {}
  async dueIds(now=new Date().toISOString(),limit=25) {
    await this.db.prepare("UPDATE analytics_deliveries SET state=CASE WHEN attempts>=6 THEN 'failed' ELSE 'pending' END,reason='interrupted_delivery',next_attempt_at=?,updated_at=? WHERE state='processing' AND updated_at<? AND archive_historical=0").bind(now,now,new Date(Date.parse(now)-60000).toISOString()).run();
    return (await this.db.prepare(`SELECT id FROM analytics_deliveries WHERE state='pending' AND next_attempt_at<=? AND ${available} ORDER BY next_attempt_at,created_at LIMIT ?`).bind(now,limit).all<{id:string}>()).results.map(row=>row.id);
  }
  async process(id:string,clock=new Date()):Promise<"succeeded"|"retrying"|"failed"|"not_due"> {
    const now=clock.toISOString();
    const claimed=await this.db.prepare(`UPDATE analytics_deliveries SET state='processing',attempts=attempts+1,updated_at=? WHERE id=? AND state='pending' AND next_attempt_at<=? AND ${available}`).bind(now,id,now).run();
    if(claimed.meta.changes!==1)return "not_due";
    const record=await this.db.prepare("SELECT * FROM analytics_deliveries WHERE id=? AND state='processing'").bind(id).first<ConversionRecord>();
    if(!record)return "not_due";
    try {
      const connection=await this.db.prepare(`SELECT c.credential_ciphertext FROM analytics_connections c JOIN analytics_deliveries d ON d.provider=c.provider AND d.generation=c.generation
        JOIN bookings b ON b.id=d.booking_id WHERE d.id=? AND d.state='processing' AND d.archive_historical=0 AND c.status='connected' AND NOT EXISTS(SELECT 1 FROM person_erasure_locks l WHERE l.email=b.invitee_email_folded)`).bind(id).first<{credential_ciphertext:string}>();
      if(!connection?.credential_ciphertext)throw new AnalyticsFailure("conversion_not_available");
      const credentials=JSON.parse(await unseal(connection.credential_ciphertext,this.secret));
      await uploadConversion(this.transport,record,credentials);
      await this.db.prepare("UPDATE analytics_deliveries SET state='succeeded',reason=NULL,updated_at=? WHERE id=? AND state='processing' AND attempts=?").bind(now,id,record.attempts).run();
      return "succeeded";
    } catch(error) {
      const failure=error instanceof AnalyticsFailure?error:new AnalyticsFailure("conversion_configuration_invalid");
      const delay=delays[record.attempts-1],retry=failure.retryable && delay!==undefined;
      await this.db.prepare("UPDATE analytics_deliveries SET state=?,reason=?,next_attempt_at=?,updated_at=? WHERE id=? AND state='processing' AND attempts=?").bind(retry?'pending':'failed',failure.code,retry?new Date(clock.getTime()+Math.max(delay,failure.retryAfterSeconds*1000)).toISOString():now,now,id,record.attempts).run();
      if(failure.code==='conversion_authorization_refused')await this.db.prepare("UPDATE analytics_connections SET status='needs_reconnect',reason=?,updated_at=? WHERE provider=? AND generation=?").bind(failure.code,now,record.provider,record.generation).run();
      return retry?'retrying':'failed';
    }
  }
}
