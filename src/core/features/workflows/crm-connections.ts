import { createId, nowIso } from "../../shared/ids";
import { seal } from "../../platform/crypto/sealed";
import { checkHubspotProperties } from "./crm-provider";

export class WorkflowCrmConnections {
 constructor(private readonly db:D1Database,private readonly secret:string,private readonly transport:typeof fetch){}
 async list(){return (await this.db.prepare("SELECT id,name,provider,status,reason,created_at AS createdAt,updated_at AS updatedAt FROM workflow_crm_connections ORDER BY id").all<{id:string}>()).results;}
 async connect(input:{name:string;accessToken:string},operatorId:string){
  await checkHubspotProperties(this.transport,input.accessToken);
  const id=createId(),now=nowIso();
  await this.db.prepare("INSERT INTO workflow_crm_connections(id,name,provider,operator_id,credential_ciphertext,status,created_at,updated_at) VALUES(?,?,'hubspot',?,?,'connected',?,?)")
   .bind(id,input.name,operatorId,await seal(input.accessToken,this.secret),now,now).run();
  return (await this.list()).find(row=>row.id===id);
 }
 async revoke(id:string){
  return (await this.db.prepare("UPDATE workflow_crm_connections SET status='revoked',credential_ciphertext=NULL,version=version+1,updated_at=? WHERE id=? AND status<>'revoked'").bind(nowIso(),id).run()).meta.changes>0;
 }
}
