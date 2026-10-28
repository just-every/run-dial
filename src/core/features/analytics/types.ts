import { z } from "zod";

export const tagsSchema = z.object({
  ga4MeasurementId: z.string().regex(/^G-[A-Z0-9]{4,30}$/).optional(),
  gtmContainerId: z.string().regex(/^GTM-[A-Z0-9]{4,30}$/).optional(),
  metaPixelId: z.string().regex(/^\d{1,30}$/).optional(),
  googleAds: z.object({ conversionId: z.string().regex(/^AW-\d{1,30}$/), conversionLabel: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) }).strict().optional(),
  linkedInPartnerId: z.string().regex(/^\d{1,30}$/).optional(),
}).strict();
export type PublicAnalytics = z.infer<typeof tagsSchema>;
const clickId = z.string().trim().min(1).max(500).regex(/^[A-Za-z0-9_.~-]+$/);
export const clickIdsSchema = z.object({ gclid: clickId.optional(), li_fat_id: clickId.optional() }).strict();
export type ClickIds = z.infer<typeof clickIdsSchema>;
export const providerSchema = z.enum(["google_ads", "linkedin"]);
export type AdsProvider = z.infer<typeof providerSchema>;
const credential = z.string().trim().min(1).max(8192).regex(/^\S+$/).refine(value => Array.from(value).every(character => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127));
const numericId = z.string().regex(/^\d{1,30}$/);
export const googleConnectionSchema = z.object({ accessToken: credential, developerToken: credential, customerId: z.string().regex(/^\d{10}$/), conversionAction: z.string().regex(/^customers\/\d{10}\/conversionActions\/\d{1,30}$/), loginCustomerId: z.string().regex(/^\d{10}$/).optional() }).strict();
export const linkedinConnectionSchema = z.object({ accessToken: credential, conversionId: numericId }).strict();
export type GoogleConnection = z.infer<typeof googleConnectionSchema>;
export type LinkedInConnection = z.infer<typeof linkedinConnectionSchema>;
export type Destination = { customerId?: string; conversionAction?: string; loginCustomerId?: string; conversionId?: string };
export type ConversionRecord = {
  id: string; booking_id: string; provider: AdsProvider; generation: number; event_id: string;
  click_id: string; destination_json: string; confirmed_at: string; attempts: number;
};
export class AnalyticsFailure extends Error {
  constructor(readonly code: string, readonly retryable = false, readonly retryAfterSeconds = 0) { super(code); }
}
