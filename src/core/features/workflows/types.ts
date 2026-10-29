import { z } from "zod";
const name=z.string().trim().min(1).max(120);
const subject=z.string().trim().min(1).max(200).refine(value=>!/[\r\n]/.test(value),"Use one subject line.");
const text=z.string().trim().min(1).max(8000);
export const workflowInput=z.object({name,eventTypeId:z.string().length(26),enabled:z.boolean().default(false),subject,text}).strict();
export const workflowPatch=z.object({name:name.optional(),enabled:z.boolean().optional(),subject:subject.optional(),text:text.optional()}).strict().refine(value=>Object.keys(value).length>0,"Supply a workflow change.");
export type WorkflowRule={
 id:string;name:string;event_type_id:string;operator_id:string;enabled:number;enabled_at:string|null;
 version:number;subject:string;text:string;removed_at:string|null;created_at:string;updated_at:string;
};
export function workflowView(row:WorkflowRule){
 return {id:row.id,name:row.name,eventTypeId:row.event_type_id,createdBy:row.operator_id,
  trigger:"booking-created",action:"email-invitee",enabled:row.enabled===1,enabledAt:row.enabled_at,
  version:row.version,subject:row.subject,text:row.text,createdAt:row.created_at,updatedAt:row.updated_at};
}
