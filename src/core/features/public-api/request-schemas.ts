import { z } from "zod";
import { hostDateSchema, ianaTimeZoneSchema } from "../../shared/scheduling";
import { formParams, submissionSchema } from "../routing";

const instant=z.string().datetime({offset:true}).transform(value=>new Date(value).toISOString());
export const apiAvailabilityQuerySchema=z.object({eventTypeId:z.string().length(26),week:hostDateSchema.optional(),inviteeTimezone:ianaTimeZoneSchema.optional(),durationMinutes:z.coerce.number().int().min(5).max(480).optional()}).strict();
export const apiBookingCreateSchema=z.object({eventTypeId:z.string().length(26),startAt:instant,inviteeTimezone:ianaTimeZoneSchema,name:z.string().trim().min(1).max(160),email:z.string().email().max(320),answers:z.record(z.string().max(100),z.union([z.string().max(4000),z.array(z.string().max(500)).max(50)])),durationMinutes:z.number().int().min(5).max(480).optional(),locationId:z.string().max(80).optional(),locationInput:z.string().max(1000).optional()}).strict();
export const apiCancellationSchema=z.object({reason:z.string().trim().max(500).optional()}).strict();
export const apiRescheduleSchema=z.object({startAt:instant,inviteeTimezone:ianaTimeZoneSchema,reason:z.string().trim().max(500).optional(),durationMinutes:z.number().int().min(5).max(480).optional()}).strict();
export const apiAttendanceSchema=z.object({status:z.enum(["attended","no_show"]),note:z.string().trim().max(4000)}).strict();
export const apiTeamSchema=z.object({name:z.string().trim().min(1).max(120),eventTypeIds:z.array(z.string().length(26)).max(50)}).strict();
export const apiRoutingSubmissionSchema=z.object({formId:formParams.shape.id,answers:submissionSchema.shape.answers}).strict();
export const apiWebhookSchema=z.object({endpoint:z.string().url().max(2048),events:z.array(z.string().max(100)).min(1).max(20)}).strict();
