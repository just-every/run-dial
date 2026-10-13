import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { validateSetup } from "../setup/configuration.mjs";

export async function setup(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--owner-email", "--prefix", "--target", "--mail-from", "--output"].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error("invalid-setup-arguments");
    options[args[i]] = args[i + 1];
  }
  const prompts = [["--owner-email", "First operator email: "], ["--prefix", "Resource prefix [rer-seedproof-dial]: "], ["--target", "Exact https://<prefix>.<account>.workers.dev origin: "], ["--mail-from", "Verified SendGrid sender email: "], ["--output", "Absolute setup JSON output path: "]];
  const missing = prompts.filter(([key]) => !options[key]);
  if (missing.length) {
    if (!process.stdin.isTTY) throw new Error("missing-setup-inputs");
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    try { for (const [key, prompt] of missing) options[key] = (await readline.question(prompt)).trim() || (key === "--prefix" ? "rer-seedproof-dial" : ""); }
    finally { readline.close(); }
  }
  const configuration = validateSetup({ version: 1, ownerEmail: options["--owner-email"].trim().toLowerCase(), prefix: options["--prefix"], target: options["--target"], mailProvider: "sendgrid", mailFrom: options["--mail-from"] });
  const output = options["--output"];
  if (output !== resolve(output)) throw new Error("setup-output-must-be-absolute");
  await writeFile(output, JSON.stringify(configuration, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { ok: true, scope: "local-setup-inputs-only", output, deployed: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await setup())); }
  catch (error) { console.error(JSON.stringify({ ok: false, code: error.message })); process.exitCode = 1; }
}
