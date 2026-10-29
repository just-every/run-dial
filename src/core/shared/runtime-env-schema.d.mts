import type { z } from "zod";

// Type surface for the portable ESM schema; all validation lives in its .mjs source.
export const runtimeEnvironmentSchema: z.ZodObject<{
  ENVIRONMENT: z.ZodEnum<{ development: "development"; preview: "preview"; production: "production" }>;
  APP_URL: z.ZodString;
  SESSION_SECRET: z.ZodString;
  OWNER_EMAIL: z.ZodOptional<z.ZodString>;
  SETUP_TOKEN: z.ZodOptional<z.ZodString>;
  RER_MANAGEMENT_ORIGIN: z.ZodOptional<z.ZodString>;
  RER_INSTALLATION_ID: z.ZodOptional<z.ZodString>;
  RER_OWNER_CLAIM_ISSUER: z.ZodOptional<z.ZodString>;
  RER_OWNER_CLAIM_INSTALLATION_ID: z.ZodOptional<z.ZodString>;
  RER_OWNER_CLAIM_APP_ORIGIN: z.ZodOptional<z.ZodString>;
  RER_OWNER_CLAIM_PUBLIC_KEYS: z.ZodOptional<z.ZodString>;
  MAIL_PROVIDER: z.ZodOptional<z.ZodEnum<{ sendgrid: "sendgrid"; resend: "resend"; rer: "rer"; development: "development" }>>;
  MAIL_API_KEY: z.ZodOptional<z.ZodString>;
  MAIL_FROM: z.ZodOptional<z.ZodString>;
  MAIL_RELAY_URL: z.ZodOptional<z.ZodString>;
  MAIL_WEBHOOK_KEY: z.ZodOptional<z.ZodString>;
  CALENDAR_PROVIDER: z.ZodOptional<z.ZodEnum<{ google: "google"; microsoft: "microsoft" }>>;
  MICROSOFT_OAUTH_CLIENT_ID: z.ZodOptional<z.ZodString>;
  MICROSOFT_OAUTH_CLIENT_SECRET: z.ZodOptional<z.ZodString>;
  GOOGLE_OAUTH_CLIENT_ID: z.ZodOptional<z.ZodString>;
  GOOGLE_OAUTH_CLIENT_SECRET: z.ZodOptional<z.ZodString>;
  CALENDAR_WEBHOOK_SECRET: z.ZodOptional<z.ZodString>;
  SLACK_CLIENT_ID: z.ZodOptional<z.ZodString>;
  SLACK_CLIENT_SECRET: z.ZodOptional<z.ZodString>;
  QBO_CLIENT_ID: z.ZodOptional<z.ZodString>;
  QBO_CLIENT_SECRET: z.ZodOptional<z.ZodString>;
  QBO_ENVIRONMENT: z.ZodOptional<z.ZodEnum<{ production: "production"; sandbox: "sandbox" }>>;
  STRIPE_SECRET_KEY: z.ZodOptional<z.ZodString>;
  STRIPE_CONNECT_CLIENT_ID: z.ZodOptional<z.ZodString>;
  STRIPE_WEBHOOK_SECRET: z.ZodOptional<z.ZodString>;
  RESEND_API_KEY: z.ZodOptional<z.ZodString>;
  RESEND_FROM_EMAIL: z.ZodOptional<z.ZodString>;
  RESEND_WEBHOOK_SECRET: z.ZodOptional<z.ZodString>;
  RER_DEMO: z.ZodOptional<z.ZodLiteral<"1">>;
}>;
