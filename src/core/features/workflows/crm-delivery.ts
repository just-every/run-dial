import { createId } from "../../shared/ids";
import { unseal } from "../../platform/crypto/sealed";
import { CrmFailure, hubspotRequest } from "./crm-provider";
import { workflowCrmAuthority } from "./crm-queue";
import type { DeliveryJobDispatcher } from "../delivery";

type Run={id:string;lease_id:string;properties_json:string;contact_id:string|null;credential_ciphertext:string;invitee_email:string;connection_id:string};
export class WorkflowCrmDelivery {
 constructor(private readonly db:D1Database,private readonly secret:string,private readonly transport:typeof fetch){}
 async enqueueDue(queue:DeliveryJobDispatcher,now=new Date()){
  const at=now.toISOString();
  await this.db.prepare(`UPDATE workflow_crm_runs AS d SET state='skipped',reason='workflow_authority_revoked',lease_id=NULL,lease_until=NULL,updated_at=?
   WHERE state IN ('pending','processing') AND NOT ${workflowCrmAuthority("d")}`).bind(at).run();
  await this.db.prepare("UPDATE workflow_crm_runs SET state='pending',lease_id=NULL,lease_until=NULL WHERE state='processing' AND lease_until<=? AND attempts<5").bind(at).run();
  await this.db.prepare("UPDATE workflow_crm_runs SET state='failed',reason='attempt_limit',updated_at=? WHERE state='processing' AND lease_until<=? AND attempts>=5").bind(at,at).run();
  const ids=(await this.db.prepare("SELECT id FROM workflow_crm_runs WHERE state='pending' ORDER BY created_at,id LIMIT 25").all<{id:string}>()).results;
  for(const {id} of ids)await queue.send({outboxId:id,channel:"workflow-crm"});
  return ids.length;
 }
 async process(id:string,now=new Date()):Promise<"succeeded"|"failed"|"not_due"> {
  const lease=createId(),at=now.toISOString();
  const claimed=await this.db.prepare(`UPDATE workflow_crm_runs AS d SET state='processing',lease_id=?,lease_until=?,attempts=attempts+1,updated_at=?
   WHERE id=? AND state='pending' AND ${workflowCrmAuthority("d")}`).bind(lease,new Date(now.getTime()+60000).toISOString(),at,id).run();
  if(!claimed.meta.changes)return "not_due";
  const row=await this.db.prepare(`SELECT d.*,c.credential_ciphertext,b.invitee_email FROM workflow_crm_runs d
   JOIN workflow_crm_connections c ON c.id=d.connection_id JOIN bookings b ON b.id=d.booking_id WHERE d.id=? AND d.lease_id=?`).bind(id,lease).first<Run>();
  if(!row)return "not_due";
  try{
   const token=await unseal(row.credential_ciphertext,this.secret);
   const contact=await hubspotRequest(this.transport,token,`/crm/v3/objects/contacts/${encodeURIComponent(row.invitee_email)}?idProperty=email&properties=email`);
   const properties=contact.properties;
   if(typeof contact.id!=="string"||!contact.id||!properties||typeof properties!=="object"||!("email" in properties)||typeof properties.email!=="string")throw new CrmFailure("crm_response_invalid");
   if(properties.email.trim().toLowerCase()!==row.invitee_email.trim().toLowerCase()||row.contact_id&&row.contact_id!==contact.id)throw new CrmFailure("crm_contact_changed");
   await this.db.prepare("UPDATE workflow_crm_runs SET contact_id=COALESCE(contact_id,?) WHERE id=? AND lease_id=?").bind(contact.id,id,lease).run();
   const active=await this.db.prepare(`SELECT id FROM workflow_crm_runs AS d WHERE d.id=? AND d.lease_id=? AND d.state='processing' AND ${workflowCrmAuthority("d")}`).bind(id,lease).first();
   if(!active)throw new CrmFailure("workflow_authority_revoked");
   // Setting the same three values is repeatable after an ambiguous response.
   // This action never creates a person, activity or task at the provider.
   await hubspotRequest(this.transport,token,`/crm/v3/objects/contacts/${encodeURIComponent(contact.id)}`,"PATCH",{properties:JSON.parse(row.properties_json)});
   await this.finish(id,lease,"sent",null,at);return "succeeded";
  }catch(error){
   const reason=error instanceof CrmFailure?error.code:"crm_delivery_failed";
   if(reason==="crm_unauthorized")await this.db.prepare("UPDATE workflow_crm_connections SET status='unhealthy',reason=?,credential_ciphertext=NULL,version=version+1,updated_at=? WHERE id=?").bind(reason,at,row.connection_id).run();
   const skipped=["crm_contact_missing","crm_contact_changed","workflow_authority_revoked"].includes(reason);
   await this.finish(id,lease,skipped?"skipped":"failed",reason,at);return "failed";
  }
 }
 private async finish(id:string,lease:string,state:string,reason:string|null,at:string){
  await this.db.prepare("UPDATE workflow_crm_runs SET state=?,reason=?,lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_id=?").bind(state,reason,at,id,lease).run();
 }
}
