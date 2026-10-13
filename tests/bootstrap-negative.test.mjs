import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const root = new URL("../", import.meta.url);
const execute = promisify(execFile);
const childEnvironment = { ...process.env };
delete childEnvironment.NODE_TEST_CONTEXT;

// Run the actual approved bootstrap assertions on isolated manifest/contract
// mutations. A second regex implementation would not prove those checks work.
async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), "dial-bootstrap-negative-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "tests"));
  await Promise.all(["tests/bootstrap.test.mjs", "tests/contract.mjs", "CONTRACT.md", "BASELINE.md", "seed.json"].map((path) => copyFile(new URL(path, root), join(directory, path))));
  const originalManifest = JSON.parse(await readFile(join(directory, "seed.json"), "utf8"));
  const originalContract = await readFile(join(directory, "CONTRACT.md"), "utf8");
  return async (change, failureTitle) => {
    const manifest = structuredClone(originalManifest);
    const contract = change(manifest, originalContract);
    await writeFile(join(directory, "seed.json"), JSON.stringify(manifest));
    await writeFile(join(directory, "CONTRACT.md"), contract);
    let code = 0, output;
    try { ({ stdout: output } = await execute(process.execPath, ["--test", "--test-reporter=tap", "tests/bootstrap.test.mjs"], { cwd: directory, env: childEnvironment })); }
    catch (error) { code = error.code; output = error.stdout; }
    assert.equal(code, failureTitle ? 1 : 0, output);
    assert.match(output, /# tests 8\b/); assert.match(output, /# skipped 0\b/);
    if (failureTitle) assert.ok(output.split("\n").some((line) => line.startsWith("not ok ") && line.includes(failureTitle)), output);
    else assert.match(output, /# pass 8\b/);
  };
}

test("bootstrap admits positive adapter versions and rejects zero, malformed and absent versions", async (context) => {
  const run = await fixture(context);
  const version = (value) => (manifest, contract) => {
    const index = manifest.extensionPoints.adapters.indexOf("calendar.provider.v2"); assert.ok(index >= 0);
    manifest.extensionPoints.adapters[index] = value;
    return contract.replaceAll("calendar.provider.v2", value);
  };
  await run(version("calendar.provider.v2"));
  await run(version("calendar.provider.v12"));
  for (const invalid of ["calendar.provider", "calendar.provider.v0", "calendar.provider.v01", "calendar.provider.v-1", "calendar.provider.v1.2", "calendar.provider.v2beta"]) {
    await run(version(invalid), "every candidate extension point is versioned");
  }
});

test("bootstrap refuses private route declarations and removal of the declared Start transport", async (context) => {
  const run = await fixture(context);
  await run((_manifest, contract) => contract);
  for (const extra of ["/app", "/app/", "/api/app/"]) {
    await run((manifest, contract) => { manifest.deploy.publicPaths.push(extra); return contract; }, "public paths expose the landing and sign-in but not the operator app");
  }
  await run((manifest, contract) => { manifest.deploy.publicPaths = manifest.deploy.publicPaths.filter((path) => path !== "/_serverFn/"); return contract; }, "public paths expose the landing and sign-in but not the operator app");
});
