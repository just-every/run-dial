import { assert, resourceName } from "../../modules/deploy-kit/validation.mjs";
export const emailAddress = value => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export function validateSetup(value) {
  assert(value && Object.keys(value).sort().join(",") === "mailFrom,mailProvider,ownerEmail,prefix,target,version", "unexpected-setup-fields");
  assert(value?.version === 1 && emailAddress(value.ownerEmail), "invalid-owner-email");
  assert(resourceName(value.prefix) && value.prefix.length <= 48, "invalid-resource-prefix");
  assert(value.mailProvider === "sendgrid" && emailAddress(value.mailFrom), "invalid-mail-configuration");
  const url = new URL(value.target);
  assert(url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash && !url.port && url.hostname.startsWith(value.prefix + ".") && /^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname), "invalid-workers-dev-target");
  assert(value.target === url.origin, "target-must-be-canonical-origin");
  return value;
}
