import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { contractTitle } from "./contract.mjs";

const root = new URL("../", import.meta.url);
const CLAUSE_ID = /\*\*([A-Z][A-Z-]*-\d{3})\s+—/g;

const readContract = () => readFile(new URL("CONTRACT.md", root), "utf8");
const readManifest = async () => JSON.parse(await readFile(new URL("seed.json", root), "utf8"));

test("the manifest maps every product clause exactly once", async () => {
  const text = await readContract();
  const manifest = await readManifest();
  const contractIds = [...text.matchAll(CLAUSE_ID)].map((match) => match[1]);
  const mappedIds = manifest.capabilities.flatMap((capability) => capability.clauses);

  assert.equal(new Set(contractIds).size, contractIds.length, "contract IDs must be unique");
  assert.deepEqual([...mappedIds].sort(), [...contractIds].sort());
});

test("no product clause claims the reserved baseline prefix", async () => {
  const text = await readContract();
  for (const [, id] of text.matchAll(CLAUSE_ID)) {
    assert.ok(!id.startsWith("BASE-"), `${id} uses the prefix reserved for BASELINE.md`);
  }
});

test("every baseline clause a product clause supersedes exists in BASELINE.md", async () => {
  const text = await readContract();
  const baseline = await readFile(new URL("BASELINE.md", root), "utf8");
  const superseded = [...text.matchAll(/Supersedes `(BASE-[A-Z]+-\d{3})`/g)].map((match) => match[1]);

  assert.ok(superseded.length > 0, "the header names clauses that supersede a baseline ID");
  for (const id of new Set(superseded)) {
    assert.match(baseline, new RegExp(`\\*\\*${id}\\s+—`), `${id} must exist in BASELINE.md`);
  }
});

test("every contract policy and adapter is declared in the manifest", async () => {
  const text = await readContract();
  const manifest = await readManifest();
  const policies = [...text.matchAll(/Policy: `([^`]+)`/g)].map((match) => match[1]);
  const adapters = [...text.matchAll(/`((?:calendar|meeting|mail)\.provider\.v[1-9][0-9]*|mail\.sender\.v[1-9][0-9]*)`/g)].map(
    (match) => match[1],
  );

  assert.deepEqual([...new Set(policies)].sort(), [...manifest.extensionPoints.policies].sort());
  for (const adapter of new Set(manifest.extensionPoints.adapters)) {
    assert.ok(adapters.includes(adapter), `${adapter} must be named by a clause`);
  }
});

test("every candidate extension point is versioned", async () => {
  const manifest = await readManifest();
  for (const [kind, ids] of Object.entries(manifest.extensionPoints)) {
    for (const id of ids) assert.match(id, /\.v[1-9][0-9]*$/, `${kind} extension ${id} must be versioned`);
  }
});

test("clause-tagged tests carry the title format verify scans", () => {
  assert.equal(contractTitle("AVAIL-002", "a slot inside a buffer is not offered"), "[AVAIL-002] a slot inside a buffer is not offered");
});

test("the owner landing has a mapped public-home capability", async () => {
  const text = await readContract();
  const manifest = await readManifest();
  const home = manifest.capabilities.find((capability) => capability.id === "public-home");

  assert.match(text, /## Public home\n\n- \*\*HOME-001\s+— Product landing\.\*\*/);
  assert.deepEqual(home?.clauses, ["HOME-001"]);
});

test("public paths expose the landing and sign-in but not the operator app", async () => {
  const manifest = await readManifest();

  assert.ok(manifest.deploy.publicPaths.every(path => !/^\/(?:app|api\/app)(?:\/|$)/.test(path)), "operator surfaces are not public declarations");
  assert.ok(manifest.deploy.publicPaths.includes("/_serverFn/"), "Start's authenticated transport keeps its explicit admission boundary");
});
