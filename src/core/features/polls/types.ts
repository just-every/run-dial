import { z } from "zod";
export const pollInput = z.object({ eventTypeId:z.string().regex(/^[0-9A-Z]{26}$/), title:z.string().trim().min(1).max(180),
 participants:z.array(z.object({name:z.string().trim().min(1).max(180),email:z.string().trim().email().max(320)}).strict()).min(1).max(50),
 starts:z.array(z.string().datetime({offset:true})).min(2).max(12), closesAt:z.string().datetime({offset:true}), hold:z.boolean().default(false), showTally:z.boolean().default(false)
}).strict();
export type PollInput=z.infer<typeof pollInput>;
export type Poll={id:string;eventTypeId:string;title:string;closesAt:string;state:"open"|"closed";showTally:number;holdLinkId:string|null;reminderOffsetsMinutes:number[]};
export type Candidate={id:string;startAt:string;endAt:string};
export type Participant={id:string;name:string;email:string;revision:number};
export type Vote={candidateId:string;choice:"yes"|"if_needed"|"no"};
export type PollView=Poll & {candidates:Candidate[];participants:Array<Participant & {votes:Vote[]}>};
export type ParticipantView={id:string;title:string;closesAt:string;name:string;candidates:Candidate[];votes:Vote[];tally?:Array<{candidateId:string;yes:number;ifNeeded:number;no:number}>};

export const pollReminderInput = z.object({ offsetsMinutes: z.array(z.number().int().min(1).max(10080)).max(3).refine(values => new Set(values).size === values.length, "Choose distinct reminder offsets.") }).strict();
