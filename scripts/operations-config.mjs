import { runtimeEnvironmentSchema } from "../src/core/shared/runtime-env-schema.mjs";
import { isLoopbackHost, normalizeEmail } from "../modules/operator-auth/index.mjs";
import { validateConfig as validateMailConfig } from "../modules/mail/src/core/validation.mjs";

// Local input validation only: shared Worker grammar plus native construction limits.
export function invalidConfigurationNames(env) {
  const parsed = runtimeEnvironmentSchema.safeParse(env);
  const invalid = parsed.success ? [] : parsed.error.issues.map(issue => issue.path[0]);
  // Base auth config caps both values, including in a foundation-only install.
  // Do not construct auth here: optional owner/mail inputs must remain optional.
  for (const name of ["SESSION_SECRET", "SETUP_TOKEN"]) {
    if (typeof env[name] === "string" && env[name].length > 1024) invalid.push(name);
  }
  if (env.OWNER_EMAIL !== undefined) {
    try { normalizeEmail(env.OWNER_EMAIL); } catch { invalid.push("OWNER_EMAIL"); }
  }
  // The default auth mail factory validates only the selected remote credential;
  // development outbox construction deliberately does not receive MAIL_API_KEY.
  const provider = env.MAIL_PROVIDER || "resend";
  const apiKeyName = env.MAIL_PROVIDER ? "MAIL_API_KEY" : "RESEND_API_KEY";
  // Legacy Resend is selected without MAIL_PROVIDER, but absent optional mail
  // must remain valid for a foundation-only install.
  if (["sendgrid", "resend"].includes(provider) && (env.MAIL_PROVIDER || env[apiKeyName] !== undefined)) {
    try { validateMailConfig({ provider, mode: "production", apiKey: env[apiKeyName] }); }
    catch { invalid.push(apiKeyName); }
  }
  try {
    const url = new URL(env.APP_URL);
    const local = env.ENVIRONMENT !== "production" && isLoopbackHost(url.hostname);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || (!local && url.protocol !== "https:")) invalid.push("APP_URL");
  } catch { invalid.push("APP_URL"); }
  for (const group of [["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "CALENDAR_WEBHOOK_SECRET"], ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_WEBHOOK_SECRET"]]) {
    if (group.some((key) => env[key])) for (const key of group) if (typeof env[key] !== "string" || !env[key].trim()) invalid.push(key);
  }
  const bootstrap = ["OWNER_EMAIL", "SETUP_TOKEN", "MAIL_PROVIDER", "MAIL_API_KEY", "MAIL_FROM"];
  if (bootstrap.some(key => env[key])) {
    for (const key of bootstrap.filter(key => key !== "MAIL_API_KEY" || env.MAIL_PROVIDER !== "development")) if (typeof env[key] !== "string" || !env[key].trim()) invalid.push(key);
    if (env.MAIL_PROVIDER === "development") {
      let loopback = false;
      try { loopback = isLoopbackHost(new URL(env.APP_URL).hostname); } catch { /* APP_URL is already invalid. */ }
      if (env.ENVIRONMENT !== "development" || !loopback) invalid.push("MAIL_PROVIDER");
    }
  }
  // Match the runtime's provider selection: legacy Resend is active only without MAIL_PROVIDER.
  const senderName = env.MAIL_PROVIDER ? "MAIL_FROM" : "RESEND_FROM_EMAIL";
  const sender = env[senderName];
  if (sender && (!runtimeEnvironmentSchema.shape[senderName].safeParse(sender).success || !/^no-?reply@/i.test(sender))) {
    invalid.push(senderName);
    console.error(`Set ${senderName} to a verified noreply@ or no-reply@ sender address, then run pnpm exec rer doctor again.`);
  }
  return Object.keys(runtimeEnvironmentSchema.shape).filter(name => invalid.includes(name));
}

export function validateConfiguration(env) {
  if (invalidConfigurationNames(env).length) throw new Error("Invalid local configuration; values suppressed");
}
