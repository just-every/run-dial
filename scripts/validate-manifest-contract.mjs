import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseContract } from "../src/base/seed-contract.mjs";
import { validateContractStatus } from "./contract-status.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [contract, baseline, manifestText] = await Promise.all([
  readFile(resolve(root, "CONTRACT.md"), "utf8"),
  readFile(resolve(root, "BASELINE.md"), "utf8"),
  readFile(resolve(root, "seed.json"), "utf8"),
]);
const manifest = JSON.parse(manifestText);
const clauseIds = parseContract(contract).clauses.map(clause => clause.id);
await validateContractStatus(root, contract, clauseIds);
const mappedIds = manifest.capabilities.flatMap((capability) => capability.clauses);

assert.equal(typeof manifest.name, "string", "manifest name is required");
assert.equal(typeof manifest.id, "string", "manifest id is required");
assert.ok(Array.isArray(manifest.capabilities), "manifest capabilities must be an array");
assertUnique(clauseIds, "contract clause IDs");
assert.ok(clauseIds.every((id) => !id.startsWith("BASE-")), "BASE- is reserved for baseline clauses");
assert.deepEqual([...mappedIds].sort(), [...clauseIds].sort(), "capabilities must map every contract clause exactly once");
assertUnique(manifest.capabilities.map((capability) => capability.id), "capability IDs");

for (const id of new Set(matches(contract, /Supersedes `(BASE-[A-Z]+-\d{3})`/g))) {
  assert.match(baseline, new RegExp(`\\*\\*${id}\\s+—`), `superseded baseline clause ${id} must exist`);
}

const mechanism = await readFile(resolve(root, "docs/contract/MECHANISM.md"), "utf8");
const extensionDescription = contract + "\n" + mechanism;
const policies = [...new Set(matches(extensionDescription, /Policy: `([^`]+)`/g))].sort();
assert.deepEqual([...manifest.extensionPoints.policies].sort(), policies, "policy IDs must match the contract");
const adapters = [...new Set(matches(extensionDescription, /`(calendar\.provider\.v[1-9]\d*|mail\.sender\.v[1-9]\d*)`/g))].sort();
assert.deepEqual([...manifest.extensionPoints.adapters].sort(), adapters, "adapter IDs must match the contract");
for (const [kind, ids] of Object.entries(manifest.extensionPoints)) {
  assert.ok(Array.isArray(ids), `${kind} extension points must be an array`);
  assertUnique(ids, `${kind} extension points`);
  for (const id of ids) assert.match(id, /\.v[1-9]\d*$/, `${kind} extension ${id} must be versioned`);
}

const declaredExtensions = new Set(Object.values(manifest.extensionPoints).flat());
const sourcePaths = await sourceFiles(resolve(root, "src"));
for (const path of sourcePaths) {
  const source = await readFile(path, "utf8");
  // Extension consumers import the typed seam or registry. Other versioned strings
  // (for example cryptographic domain separators) are not extension IDs.
  if (!/from ["'].*(?:extensions|mount\.server)["']/.test(source) && !path.endsWith("/api/extensions.ts")) continue;
  for (const id of matches(source, /["'`]([a-z][a-z-]*(?:\.[a-z][a-z-]*)+\.v[1-9]\d*)["'`]/g))
    assert.ok(declaredExtensions.has(id), `${path} uses undeclared extension ID ${id}`);
}

assertUnique(manifest.externals.map((external) => external.id), "external IDs");
for (const external of manifest.externals) {
  for (const adapter of external.adapters) {
    assert.ok(manifest.extensionPoints.adapters.includes(adapter), `${external.id} names an undeclared adapter ${adapter}`);
  }
}
assertUnique(manifest.env.map((entry) => entry.name), "environment names");
for (const name of ["ENVIRONMENT", "APP_URL", "SESSION_SECRET"]) {
  assert.ok(manifest.env.some((entry) => entry.name === name && entry.required === true), `${name} must be a required runtime variable`);
}
for (const entry of manifest.env.filter((entry) => entry.required === false)) {
  // An optional variable belongs to a declared adapter, or to a declared external integration outside one.
  assert.ok(
    manifest.extensionPoints.adapters.some((adapter) => entry.why.includes(adapter)) || manifest.externals.some((external) => entry.why.includes(`external ${external.id}`)),
    `${entry.name} is not required and must name a declared adapter or external in its why`,
  );
}

assertUnique(manifest.deploy.publicPaths, "public paths");
for (const path of manifest.deploy.publicPaths) assert.ok(path.startsWith("/"), `public path ${path} must start with /`);
for (const path of ["/", "/assets/", "/signin", "/api/auth/", "/api/public/", "/health", "/privacy"]) {
  assert.ok(manifest.deploy.publicPaths.includes(path), `public path ${path} must be declared`);
}
assert.ok(!manifest.deploy.publicPaths.some((path) => path === "/app" || path.startsWith("/app/") || path === "/api/app" || path.startsWith("/api/app/")), "operator paths cannot be sessionless");

const fullBehaviourMaturities = new Set(["contract-verified", "released"]);
if (!fullBehaviourMaturities.has(manifest.maturity)) {
  console.log(`Contract integrity passed. Structural validation only at ${manifest.maturity}; 0/${clauseIds.length} behavioural clauses are claimed.`);
} else {
  const tags = await contractTags();
  const unknown = [...tags].filter((id) => !clauseIds.includes(id));
  assert.deepEqual(unknown, [], "tests name unknown contract clauses");
  const missing = clauseIds.filter((id) => !tags.has(id));
  assert.deepEqual(missing, [], "every contract clause needs a behavioural test tag after backend maturity");
  console.log(`Contract integrity passed. ${tags.size}/${clauseIds.length} behavioural clauses are tagged.`);
}

function matches(text, expression) {
  return [...text.matchAll(expression)].map((match) => match[1]);
}

function assertUnique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

async function contractTags() {
  const tests = await files(resolve(root, "tests"));
  const contents = await Promise.all(tests.map((path) => readFile(path, "utf8")));
  return new Set(contents.flatMap(text=>[
    ...matches(text,/contract\(\s*["']([A-Z][A-Z-]*-\d{3})["']/g),
    ...[...text.matchAll(/contract\(\s*\[([^\]]+)\]/g)].flatMap(match=>matches(match[1],/["']([A-Z][A-Z-]*-\d{3})["']/g)),
  ]));
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : entry.name.endsWith(".mjs") ? [path] : [];
  }));
  return nested.flat();
}

async function sourceFiles(directory) {
 const entries = await readdir(directory, {withFileTypes:true});
 return (await Promise.all(entries.map(entry => entry.isDirectory() ? sourceFiles(resolve(directory,entry.name)) : /\.tsx?$/.test(entry.name) ? [resolve(directory,entry.name)] : []))).flat();
}
