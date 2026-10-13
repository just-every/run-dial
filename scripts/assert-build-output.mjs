import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(root, "dist");

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }));
  return paths.flat();
}

const generatedFiles = await files(output);
assert.ok(!generatedFiles.some((path) => path.endsWith("/.dev.vars")), "build output must not package .dev.vars");
const clientRoot = resolve(output, "client") + sep;
const browserScripts = await Promise.all(generatedFiles.filter((path) => path.startsWith(clientRoot) && path.endsWith(".js")).map((path) => readFile(path, "utf8")));
assert.ok(browserScripts.every((source) => !source.includes("/api/app/event-types/:id/availability-diagnostics")), "private Hono diagnostic handlers must remain outside browser chunks; import them in the server composition directly");

// DOCS-001: the Markdown pipeline runs when Vite loads the docs modules and must never be emitted into the Worker or the browser bundles.
const markdownPipeline = /react-markdown|remark-gfm|micromark|mdast-util|hast-util|registerLanguage/;
const emittedCode = generatedFiles.filter((path) => /\.(?:m?js|cjs|js\.map)$/.test(path));
for (const path of emittedCode) assert.ok(!markdownPipeline.test(await readFile(path, "utf8")), `${path} must not contain the docs Markdown or highlight libraries; they are build-time only`);
