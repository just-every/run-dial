import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const directory = process.env.DIAL_TEST_DIAGNOSTICS_DIR;
if (!directory) throw new Error("DIAL_TEST_DIAGNOSTICS_DIR is required");
const previous = new Map();
async function poll() {
  let files;
  try { files = await readdir(directory); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const file of files.sort()) {
    if (!/^\d+\.json$/.test(file)) continue;
    const content = await readFile(resolve(directory, file), "utf8");
    let value;
    try { value = JSON.parse(content); } catch { continue; /* A worker is replacing its snapshot. */ }
    if (previous.get(file) === content) continue;
    previous.set(file, content);
    console.log("TEST-WORKER " + JSON.stringify(value));
  }
}
await poll();
const timer = setInterval(() => { poll().catch((error) => { console.error(error.message); process.exitCode = 1; clearInterval(timer); }); }, 30_000);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { clearInterval(timer); await poll(); });
