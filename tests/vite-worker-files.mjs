import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";

// Follow the selected entry's actual local module graph, including shared test
// helpers. Never grant a directory or traverse into another checkout's tests.
export async function workerSourceFiles(root, entry) {
  const tests = await realpath(resolve(root, "tests"));
  const files = new Set();
  const insideTests = (file) => {
    const path = relative(tests, file);
    return path !== "" && !path.startsWith("../") && !isAbsolute(path);
  };
  async function visit(path) {
    const file = await realpath(path);
    if (!insideTests(file) || files.has(file)) return;
    if (!(await stat(file)).isFile()) throw new Error("Worker source authorization requires a file.");
    files.add(file);
    const source = ts.preProcessFile(await readFile(file, "utf8"), true, true);
    for (const imported of source.importedFiles) {
      if (!imported.fileName.startsWith(".")) continue;
      const target = resolve(dirname(file), imported.fileName);
      if (!insideTests(target)) continue;
      const candidates = [target, ...[".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"].map((suffix) => target + suffix)];
      let found;
      for (const candidate of candidates) {
        try { if ((await stat(candidate)).isFile()) { found = candidate; break; } }
        catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error; }
      }
      if (!found) throw new Error(`Cannot resolve native test Worker import: ${imported.fileName}`);
      await visit(found);
    }
  }
  await visit(resolve(root, entry));
  return [...files];
}
