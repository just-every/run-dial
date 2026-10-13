import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(root, "src");
const sourceFiles = await files(sourceRoot);
const config = ts.readConfigFile(resolve(root, "tsconfig.json"), ts.sys.readFile);
assert.ok(!config.error, "Could not read tsconfig.json");
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
const failures = [];

for (const file of sourceFiles) inspectFile(file);
if (failures.length > 0) throw new Error(`Feature-boundary violations:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
console.log(`Boundary check passed for ${sourceFiles.length} source files.`);

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

function inspectFile(file) {
  const source = ts.createSourceFile(file, ts.sys.readFile(file) ?? "", ts.ScriptTarget.Latest, true);
  const sourcePath = projectPath(file);
  if (source.text.includes("context.env") && !sourcePath.startsWith("src/core/app/") && !sourcePath.startsWith("src/core/platform/")) {
    failures.push(`${sourcePath}: context.env is reserved for app composition and platform code`);
  }
  visit(source, (specifier) => {
    const target = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
    if (specifier.startsWith("drizzle-orm") && !isRepository(sourcePath) && !sourcePath.startsWith("src/core/platform/db/")) {
      failures.push(`${sourcePath}: Drizzle imports are allowed only in repositories or platform/db`);
    }
    if (specifier.includes("/platform/db/client") && !isRepository(sourcePath) && !sourcePath.startsWith("src/core/platform/db/")) {
      failures.push(`${sourcePath}: database client is allowed only in repositories or platform/db`);
    }
    if (!target || !target.startsWith(root + sep)) return;
    const targetPath = projectPath(target);
    checkExtensionBoundary(sourcePath, targetPath);
    checkFeatureBoundary(sourcePath, targetPath);
  });
}

function visit(node, onSpecifier) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    onSpecifier(node.moduleSpecifier.text);
  }
  ts.forEachChild(node, (child) => visit(child, onSpecifier));
}

function checkExtensionBoundary(sourcePath, targetPath) {
  if (sourcePath.startsWith("src/ext/") && targetPath.startsWith("src/core/") && !targetPath.startsWith("src/core/api/") && !targetPath.startsWith("src/core/shared/")) {
    failures.push(`${sourcePath}: ext may import only core/api or core/shared, not ${targetPath}`);
  }
  if (!sourcePath.startsWith("src/core/") || !targetPath.startsWith("src/ext/")) return;
  const allowed = new Map([
    ["src/core/app/mount.server.ts", "src/ext/index.server.ts"],
    ["src/core/app/public-mount.ts", "src/ext/public-config.ts"],
    ["src/core/app/extensions.tsx", "src/ext/ui.ts"],
  ]);
  if (allowed.get(sourcePath) !== targetPath) failures.push(`${sourcePath}: core may not import extension module ${targetPath}`);
}

function checkFeatureBoundary(sourcePath, targetPath) {
  const sourceFeature = featureName(sourcePath);
  const targetFeature = featureName(targetPath);
  if (!sourceFeature || !targetFeature || sourceFeature === targetFeature) return;
  // Mail composition also has a pure public index: importing runtime delivery
  // would couple repositories and portable archive tooling to Worker bindings.
  const publicMailIndex = targetFeature === "delivery" && targetPath === "src/core/features/delivery/mail/index.ts";
  if (targetPath !== `src/core/features/${targetFeature}/index.ts` && !publicMailIndex) {
    failures.push(`${sourcePath}: feature ${sourceFeature} must import ${targetFeature} through its public index`);
  }
}

function featureName(path) {
  const match = /^src\/core\/features\/([^/]+)\//.exec(path);
  return match?.[1];
}

function isRepository(path) {
  return path.endsWith("/repository.ts");
}

function projectPath(path) {
  return relative(root, path).split(sep).join("/");
}
