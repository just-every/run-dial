import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("public API reads omit operator credentials", async () => {
  const client = await readFile(resolve(root, "src/core/api/client.ts"), "utf8");
  assert.match(client, /publicApi[\s\S]*credentials:\s*"omit"/);

  const publicUi = await files(resolve(root, "src/core/features/public-booking/ui"));
  const contents = await Promise.all(publicUi.map((path) => readFile(path, "utf8")));
  assert.ok(!contents.some((text) => /api\.api\.public/.test(text)), "public UI must use the credential-omitting client");
});

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".tsx")).map((entry) => resolve(directory, entry.name));
}
