// A package-mode checkout's commands outside package.json and OPERATIONS.json:
// its delivery operations (rer-project.json, and the delivery producer's
// packaging.json that rer-project.json is generated from), the scripts those
// operations and its CI workflows run, and the workflows themselves. Converting
// to package mode rewrites their calls into the removed vendored copy
// (scripts/rer.mjs, scripts/base-cli, scripts/base-onboarding); check fails
// while any remains.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// A command line that runs a file of the vendored copy, and (in a JavaScript
// file) a string literal naming one, as a spawn argument does.
const vendoredCall = /\b(?:node|bash|sh)\s+(?:\.\/)?scripts\/(?:rer\.mjs|base-cli\/|base-onboarding\/)/;
const vendoredLiteral = /(['"`])(?:\.\/)?scripts\/(?:rer\.mjs|base-cli\/|base-onboarding\/)[^'"`\n]*\1/;
const commentLine = /^\s*(?:#|\/\/|\/?\*)/;
const jsFile = /\.(?:mjs|cjs|js)$/;
// A seed-relative script path in a command.
const scriptToken = /(?<![\w./$-])(?:\.\/)?((?:[\w.-]+\/)*[\w.-]+\.(?:sh|bash|mjs|cjs|js))(?![\w./-])/g;

// The files holding delivery operations, and where in each they are.
export const operationFiles = [
 { file: 'rer-project.json', operations: value => value?.operations },
 { file: 'scripts/delivery/base/packaging.json', operations: value => value?.project?.operations },
];

async function text(root, file) {
 try { return await readFile(resolve(root, file), 'utf8'); } catch (error) { if (error.code === 'ENOENT' || error.code === 'EISDIR') return undefined; throw error; }
}

// Each operations file present: { file, text, value, operations }.
export async function operationSources(root) {
 const found = [];
 for (const { file, operations } of operationFiles) {
  const source = await text(root, file);
  if (source === undefined) continue;
  let value; try { value = JSON.parse(source); } catch { continue; }
  const commands = operations(value);
  if (commands && typeof commands === 'object') found.push({ file, text: source, value, operations: commands });
 }
 return found;
}

// The checkout's CI workflow files: { file, text }.
export async function workflowSources(root) {
 let names;
 try { names = await readdir(resolve(root, '.github/workflows')); } catch { return []; }
 const found = [];
 for (const name of names.filter(name => /\.ya?ml$/.test(name)).sort()) found.push({ file: `.github/workflows/${name}`, text: await text(root, `.github/workflows/${name}`) });
 return found.filter(source => source.text !== undefined);
}

// The seed's own script files a command runs (that exist, outside node_modules
// and the vendored copy).
export async function calledScripts(root, command) {
 const found = [];
 for (const [, path] of command.matchAll(scriptToken)) {
  if (/^(?:node_modules\/|scripts\/(?:rer\.mjs$|base-cli\/|base-onboarding\/))/.test(path) || found.includes(path)) continue;
  if (await text(root, path) !== undefined) found.push(path);
 }
 return found;
}

// Every place these commands still call the vendored copy, as `file:line: text`
// (or `file operations.NAME: command`).
export async function vendoredCalls(root) {
 const calls = [], scripts = new Set();
 for (const { file, operations } of await operationSources(root)) for (const [name, command] of Object.entries(operations)) {
  if (typeof command !== 'string') continue;
  if (vendoredCall.test(command)) calls.push(`${file} operations.${name}: ${command}`);
  for (const path of await calledScripts(root, command)) scripts.add(path);
 }
 const lines = (file, source, literals) => source.split('\n').forEach((line, index) => {
  if (!commentLine.test(line) && (vendoredCall.test(line) || (literals && vendoredLiteral.test(line)))) calls.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
 });
 for (const { file, text: source } of await workflowSources(root)) {
  lines(file, source, false);
  for (const path of await calledScripts(root, source)) scripts.add(path);
 }
 for (const path of [...scripts].sort()) lines(path, await text(root, path), jsFile.test(path));
 return calls;
}
