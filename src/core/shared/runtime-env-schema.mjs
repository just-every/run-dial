import { z } from "zod";

// The Worker and local operations checks share every field's grammar and optionality.
export const runtimeEnvironmentSchema = z.object({
  ENVIRONMENT: z.enum(["development", "preview", "production"]),
  APP_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  OWNER_EMAIL: z.string().email().optional(),
  SETUP_TOKEN: z.string().min(32).optional(),
  RER_MANAGEMENT_ORIGIN: z.string().url().optional(),
  RER_INSTALLATION_ID: z.string().min(1).optional(),
  RER_OWNER_CLAIM_ISSUER: z.string().url().optional(),
  RER_OWNER_CLAIM_INSTALLATION_ID: z.string().min(1).optional(),
  RER_OWNER_CLAIM_APP_ORIGIN: z.string().url().optional(),
  RER_OWNER_CLAIM_PUBLIC_KEYS: z.string().min(1).optional(),
  MAIL_PROVIDER: z.enum(["sendgrid", "resend", "rer", "development"]).optional(),
  MAIL_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().email().optional(),
  MAIL_RELAY_URL: z.string().refine(value => value === "" || z.string().url().safeParse(value).success, "Invalid mail relay URL").optional(),
  MAIL_WEBHOOK_KEY: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  CALENDAR_WEBHOOK_SECRET: z.string().min(32).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Demo mode (`rer demo` or a hosted demo container): public reads run for real, external writes are mocked and mail is suppressed.
  RER_DEMO: z.literal("1").optional(),
});
