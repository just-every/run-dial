import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { testPartitions } from "./ci-test-files.mjs";

// CI partitions the same checks as scripts/verify.mjs. Local pnpm verify keeps
// the complete ordered command, including both slow journeys, unchanged.
const groups = {
  static: ["lint", "boundaries", "validate", "typecheck", "migration:check", "verify:copies", "integrations:check"],
  build: ["build", "verify:build-output", "deployment-spec:check", "check", "verify:delivery"],
  editor: ["verify:managed-editor"],
};
const [group, selection, ...extra] = process.argv.slice(2);
const partitions = await testPartitions();
let selected;
if (group === "test" && /^\d+$/.test(selection ?? "")) selected = partitions.shards[Number(selection)];
if (group === "journeys") selected = partitions.journeys[selection];
if (extra.length || (groups[group] ? selection !== undefined : !selected?.length)) {
  throw new Error("Usage: node scripts/ci-verify.mjs static|build|editor|test SHARD|journeys installer|cron");
}

process.env.DIAL_EVIDENCE_DIR ??= await mkdtemp(resolve(tmpdir(), "dial-ci-verify-"));
const { evidencePath } = await import("./evidence-path.mjs");
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
async function hashes() {
  return Object.fromEntries(await Promise.all(files.map(async file => {
    try { return [file, createHash("sha256").update(await readFile(file)).digest("hex")]; }
    catch (error) { if (error.code === "ENOENT") return [file, null]; throw error; }
  })));
}
function run(command, args) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? done() : reject(new Error(`${command} ${args.join(" ")} failed: ${signal ?? code}`)));
  });
}
const before = await hashes();
let failure;
try {
  if (selected) {
    console.log(`CI ${group} ${selection}: ${selected.join(", ")}`);
    await run(process.execPath, ["--test", "--test-concurrency=2", ...selected]);
  } else {
    for (const step of groups[group]) await run("pnpm", ["run", step]);
    if (group === "build") {
      // rer verify also performs these native checks after verify:app. Use the
      // pinned CLI implementations and its actual adapter declarations here.
      const { resolveProject } = await import("@runeditrun/rer/internal/cli/project.mjs");
      const { checkHostedOutput } = await import("@runeditrun/rer/internal/cli/hosted-output.mjs");
      const { checkAgentDoor } = await import("@runeditrun/rer/internal/cli/agent-door.mjs");
      const { checkHydration } = await import("@runeditrun/rer/internal/cli/hydration/check.mjs");
      const { adapter } = await resolveProject(process.cwd());
      const declaration = adapter.deployDeclaration ?? adapter.deploy?.declaration;
      console.log(await checkHostedOutput(process.cwd(), { declaration }));
      await checkHydration(process.cwd(), { pages: adapter.publicPages, declaration, report: lines => lines.forEach(line => console.log(line)) });
      await checkAgentDoor(process.cwd(), { declaration, owner: adapter.hooks?.owner });
    }
  }
} catch (error) { failure = error; }
const after = await hashes();
const changed = files.filter(file => before[file] !== after[file]);
await writeFile(evidencePath("tracked-input-nonmutation.json"), JSON.stringify({ checked: files.length, changed, checksPassed: !failure }, null, 2));
console.log(`Verification evidence: ${process.env.DIAL_EVIDENCE_DIR}`);
if (changed.length) throw new Error(`Verification changed tracked files: ${changed.join(", ")}`);
if (failure) throw failure;
