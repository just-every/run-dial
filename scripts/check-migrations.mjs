import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrations = await readdir(resolve(root, "migrations/core"));
const migrationNames = migrations.filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
assert.ok(migrationNames.length > 0, "at least one immutable core migration is required");
assert.deepEqual(migrationNames, [...migrationNames].sort(), "core migrations must be lexically ordered");
assert.equal(new Set(migrationNames.map((name) => name.slice(0, 4))).size, migrationNames.length, "core migration prefixes must be unique");

const persistDirectory = await mkdtemp(resolve(tmpdir(), "dial-migrations-"));
try {
  await run("node", ["scripts/render-wrangler.mjs"]);
  await run("pnpm", [
    "exec", "wrangler", "d1", "migrations", "apply", "dial-local",
    "--local", "--persist-to", persistDirectory,
    "--config", "wrangler.toml",
  ]);
  console.log(`Replayed ${migrationNames.length} immutable core migrations in an isolated D1 directory.`);
} finally {
  await rm(persistDirectory, { recursive: true, force: true });
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, CI: "1" } });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)));
  });
}
