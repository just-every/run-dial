import { z } from 'zod';
const count=z.object({read:z.number().int().nonnegative(),imported:z.number().int().nonnegative(),changed:z.number().int().nonnegative(),skipped:z.number().int().nonnegative(),rejected:z.number().int().nonnegative()}).strict();
const n=z.number().int().nonnegative();
const shared={evidence:z.literal('synthetic-only'),state:z.string(),sourceUser:z.object({name:z.string(),timezone:z.string(),handle:z.string()}).strict(),asOf:z.string().datetime(),hostZone:z.string(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/u),counts:z.record(z.string(),count),events:z.array(z.object({sourceId:z.string(),mapped:z.unknown()})),erasedRecords:n};
const item=(outcomes:readonly [string,...string[]])=>z.object({kind:z.enum(['profile','eventTypes','questions','locations','availability','overrides','settings','bookings']),sourceId:z.string(),name:z.string(),outcome:z.enum(['imported','changed','skipped','rejected']),reason:z.string(),startAt:z.string().optional(),bookingOutcome:z.enum(outcomes).optional()}).strict();
const v1Outcomes=['toImport','past','cancelled','severalInvitees','skippedEvent','overlapping','invalid'] as const;
export const bookingOutcomes=[...v1Outcomes,'movedAtSource'] as const;
export const differenceKinds=['unchanged','moved','cancelled','invitee_changed','missing'] as const;
/** Reports downloaded before catch-up existed keep validating as version 1. */
const reportV1=z.object({version:z.literal(1),...shared,bookingCounts:z.object({read:n,toImport:n,past:n,cancelled:n,severalInvitees:n,skippedEvent:n,overlapping:n,invalid:n}).strict(),items:z.array(item(v1Outcomes))}).strict();
export const difference=z.object({bookingId:z.string(),name:z.string(),kind:z.enum(differenceKinds),startAt:z.string().datetime(),originalStartAt:z.string().datetime(),sourceStartAt:z.string().datetime().nullable(),decision:z.enum(['kept','released','cancelled','rescheduled']).nullable(),resolved:z.boolean()}).strict();
export const reportV2=z.object({version:z.literal(2),...shared,mode:z.enum(['first','catch-up']),capturedAt:z.string().datetime().nullable(),alreadyHere:z.object({profile:n,eventTypes:n,bookings:n}).strict(),bookingCounts:z.object({read:n,toImport:n,past:n,cancelled:n,severalInvitees:n,skippedEvent:n,overlapping:n,invalid:n,movedAtSource:n}).strict(),items:z.array(item(bookingOutcomes)),differences:z.array(difference)}).strict();
export const reportSchema=z.union([reportV1,reportV2]);
