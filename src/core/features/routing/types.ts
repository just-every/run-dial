import { z } from "zod";
const id = z.string().regex(/^[0-9A-Z]{26}$/);
const key = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/);
export const formSchema = z.object({
 title:z.string().trim().min(1).max(160),
 questions:z.array(z.object({key,label:z.string().trim().min(1).max(160),required:z.boolean()}).strict()).min(1).max(30),
 rules:z.array(z.object({id:z.string().min(1).max(80),questionKey:key,equals:z.string().max(2000),eventTypeId:id,teamId:id.optional()}).strict()).max(50),
 defaultMessage:z.string().trim().min(1).max(2000),
}).strict().superRefine((value,context)=>{
 const keys=new Set(value.questions.map(question=>question.key));
 if(keys.size!==value.questions.length)context.addIssue({code:"custom",path:["questions"],message:"Question keys must be unique."});
 if(new Set(value.rules.map(rule=>rule.id)).size!==value.rules.length)context.addIssue({code:"custom",path:["rules"],message:"Rule IDs must be unique."});
 value.rules.forEach((rule,index)=>{if(!keys.has(rule.questionKey))context.addIssue({code:"custom",path:["rules",index,"questionKey"],message:"Choose a configured question."});});
});
export const formParams = z.object({id});
export const submissionSchema=z.object({nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/),answers:z.record(z.string().max(64),z.string().max(2000)).refine(value=>Object.keys(value).length<=30)}).strict();
export type RoutingForm = z.infer<typeof formSchema>;
export type FormRow = {id:string;title:string;hostId:string;configJson:string};
export type SubmissionResult = {submissionId:string;eventTypeId:string;bookingPath:string} | {submissionId:string;message:string};
