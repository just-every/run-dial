import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_DEV_KEY } from "./dev-key.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const variablesDirectory = process.env.DIAL_DEV_VARS_DIR ? resolve(process.env.DIAL_DEV_VARS_DIR) : root;
const isolatedEnvironment = process.env.DIAL_DEV_ENV;
if (isolatedEnvironment && !/^[a-zA-Z0-9_-]+$/.test(isolatedEnvironment)) throw new Error("DIAL_DEV_ENV must contain only letters, digits, underscores, or hyphens");
const sharedDestination = resolve(variablesDirectory, ".dev.vars");
const destination = resolve(variablesDirectory, isolatedEnvironment ? `.dev.vars.${isolatedEnvironment}` : ".dev.vars");
const port = process.env.DIAL_PORT ?? "8787";
let contents = "";

try {
  contents = await readFile(destination, "utf8");
} catch {
  if (isolatedEnvironment) {
    try {
      contents = await readFile(sharedDestination, "utf8");
    } catch {
      // A clean clone gets its local secret only when development is explicitly started.
    }
  }
}

let secret = contents.match(/^SESSION_SECRET=(.+)$/m)?.[1]?.trim() ?? "";
if (secret.length < 32) secret = randomBytes(32).toString("base64url");
const owner = process.env.OWNER_EMAIL ?? contents.match(/^OWNER_EMAIL=(.+)$/m)?.[1]?.trim();
if (!owner) throw new Error("Missing OWNER_EMAIL: provide the first operator email when starting local development.");
const setup = process.env.SETUP_TOKEN ?? contents.match(/^SETUP_TOKEN=(.+)$/m)?.[1]?.trim() ?? randomBytes(32).toString("base64url");
const from = process.env.MAIL_FROM ?? contents.match(/^MAIL_FROM=(.+)$/m)?.[1]?.trim() ?? owner;
const preserved = contents
  .split(/\r?\n/)
  .filter((line) => !/^(ENVIRONMENT|APP_URL|SESSION_SECRET|OWNER_EMAIL|SETUP_TOKEN|MAIL_FROM|MAIL_PROVIDER|RER_DEV_KEY)=/.test(line))
  .filter((line) => line.length > 0);
await mkdir(variablesDirectory, { recursive: true });
await writeFile(destination, [...preserved, `OWNER_EMAIL=${owner}`, `SETUP_TOKEN=${setup}`, `MAIL_FROM=${from}`, "ENVIRONMENT=development", "MAIL_PROVIDER=development", `RER_DEV_KEY=${TEST_DEV_KEY}`, `APP_URL=http://127.0.0.1:${port}`, `SESSION_SECRET=${secret}`, ""].join("\n"), { mode: 0o600 });
