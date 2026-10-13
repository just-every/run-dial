import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./base-cli/cli/jsonc.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "deploy/wrangler.template.toml");
const configuredDestination = process.env.DIAL_WRANGLER_CONFIG_PATH ?? "wrangler.toml";
const destination = resolve(root, configuredDestination);

let toml = await readFile(source, "utf8");
await assertRootDeclaration(toml);
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

// rer reads the deployed entry and the Cron schedule from the root wrangler.jsonc only, so that file repeats them. Refuse to
// render, and with it to build, set up or verify, when the two declarations have drifted apart.
async function assertRootDeclaration(template) {
  const declared = parseJsonc(await readFile(resolve(root, "wrangler.jsonc"), "utf8"));
  const triggers = /^\[triggers\]\s*\ncrons = (\[[^\n]*\])\s*$/m.exec(template);
  const expected = { main: /^main = "([^"]+)"$/m.exec(template)?.[1], crons: triggers ? JSON.parse(triggers[1]) : [] };
  const actual = { main: declared.main, crons: declared.triggers?.crons ?? [] };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`wrangler.jsonc must declare the same main and triggers.crons as deploy/wrangler.template.toml: template ${JSON.stringify(expected)}, wrangler.jsonc ${JSON.stringify(actual)}.`);
  }
}
