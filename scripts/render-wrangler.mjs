import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "deploy/wrangler.template.toml");
const configuredDestination = process.env.DIAL_WRANGLER_CONFIG_PATH ?? "wrangler.toml";
const destination = resolve(root, configuredDestination);

let toml = await readFile(source, "utf8");
// Runtime setup supplies the sender through deploy.json's secret binding.
// Keep it out of generated vars as well as container images so a placeholder
// cannot shadow the installed sender. Direct installs retain SendGrid.
toml = toml.replace('ENVIRONMENT = "production"\n', 'ENVIRONMENT = "production"\nMAIL_PROVIDER = "sendgrid"\nMAIL_RELAY_URL = ""\n');
if (dirname(destination) !== root) {
  const workerEntry = resolve(root, "src/core/app/worker.ts").replaceAll("\\", "\\\\");
  const migrations = resolve(root, "migrations/core").replaceAll("\\", "\\\\");
  toml = toml.replace(/^main = .+$/m, `main = "${workerEntry}"`).replace(/^migrations_dir = .+$/m, `migrations_dir = "${migrations}"`);
}
const existing = await readFile(destination, "utf8").catch(error => {
  if (error.code !== "ENOENT") throw error;
});
// Preview certifies input metadata as well as bytes across its build. Preserve
// the generated config's identity when the template has not changed.
if (existing !== toml) {
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, toml);
}
