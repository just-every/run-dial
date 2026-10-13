import { readFile } from 'node:fs/promises';
import { contained } from './project.mjs';
import { parseJsonc } from './jsonc.mjs';

// Where a seed's real Worker configuration lives: the path devIdentity.deployConfig
// names, else wrangler.jsonc, wrangler.json and wrangler.toml, then a deploy
// template such as deploy/wrangler.template.toml. A file the adapter lists in
// generatedOutputs holds whichever configuration was built last, so it is never a
// source. `rer check` (the deployed main) and `rer dev`/`rer preview` (the Cron
// Triggers) read these same files.
const deployConfigs = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'], deployTemplates = ['deploy/wrangler.template.toml', 'deploy/wrangler.template.jsonc', 'deploy/wrangler.template.json', 'wrangler.template.toml', 'wrangler.template.jsonc', 'wrangler.template.json'];

export function deployConfigPaths(adapter) {
 const declared = adapter?.devIdentity?.deployConfig, generated = new Set((adapter?.generatedOutputs ?? []).map(path => path.replace(/^\.\//, '')));
 return typeof declared === 'string' ? [declared] : [...deployConfigs.filter(path => !generated.has(path)), ...deployTemplates];
}

export async function readProjectText(root, path) {
 try { return await readFile(await contained(root, path), 'utf8'); } catch { return null; }
}

// Top-level `main = "..."` only: a table header ends the top level.
export function tomlMain(source) {
 for (const line of source.split('\n')) {
  if (/^\s*\[/.test(line)) return undefined;
  const match = /^\s*main\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(line);
  if (match) return match[1] ?? match[2];
 }
}
export function jsoncMain(source) {
 try { return JSON.parse(source.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')).main; } catch { return undefined; }
}

// The deployed Worker entry (`main`) from the first of those files that exists.
export async function deployedMain(root, adapter) {
 for (const path of deployConfigPaths(adapter)) {
  const source = await readProjectText(root, path);
  if (source === null) continue;
  return (/\.toml$/.test(path) ? tomlMain(source) : jsoncMain(source))?.replace(/^\.\//, '');
 }
}

// Statements of a TOML file with comments removed: one line, or several while a
// value's bracket is still open. Strings are respected.
function tomlStatements(source) {
 const statements = [];
 let current = '', depth = 0, quote = '';
 for (let i = 0; i < source.length; i++) {
  const char = source[i];
  if (quote) {
   current += char;
   if (char === '\\' && quote === '"') current += source[++i] ?? '';
   else if (char === quote) quote = '';
  } else if (char === '"' || char === "'") { quote = char; current += char; }
  else if (char === '#') { while (i + 1 < source.length && source[i + 1] !== '\n') i++; }
  else if (char === '\n') {
   if (depth > 0) current += ' ';
   else { statements.push(current); current = ''; }
  } else {
   if (current.includes('=')) { if (char === '[' || char === '{') depth++; else if (char === ']' || char === '}') depth--; }
   current += char;
  }
 }
 statements.push(current);
 return statements.map(text => text.trim()).filter(Boolean);
}

function tomlStrings(text, path) {
 const list = /^\[([\s\S]*)\]$/.exec(text.trim());
 if (!list) throw new Error(`${path} triggers.crons must be a list of cron expressions.`);
 const body = list[1], values = [], pattern = /\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:,|$)/y;
 while (pattern.lastIndex < body.length && body.slice(pattern.lastIndex).trim()) {
  const match = pattern.exec(body);
  if (!match) throw new Error(`${path} triggers.crons must be a list of cron expressions.`);
  values.push(match[1] === undefined ? match[2] : JSON.parse(`"${match[1]}"`));
 }
 return values;
}

// The top-level `triggers.crons` of a wrangler.toml (the [triggers] table, a
// dotted `triggers.crons` key, or an inline `triggers = { crons = [...] }`);
// undefined when the file declares none. Environment tables are not read.
export function tomlCrons(source, path = 'wrangler.toml') {
 let table = '';
 for (const statement of tomlStatements(source)) {
  const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(statement);
  if (header) { table = header[1].replace(/\s+/g, ''); continue; }
  const pair = /^([A-Za-z0-9_.\-"' ]+?)\s*=\s*([\s\S]*)$/.exec(statement);
  if (!pair) continue;
  const key = (table ? `${table}.` : '') + pair[1].replace(/\s+/g, '');
  if (key === 'triggers.crons') return tomlStrings(pair[2], path);
  if (key === 'triggers') {
   const inline = /crons\s*=\s*(\[[\s\S]*?\])/.exec(pair[2]);
   if (inline) return tomlStrings(inline[1], path);
  }
 }
}

function jsoncCrons(source, path) {
 let config;
 try { config = parseJsonc(source); } catch (error) { throw new Error(`${path}: ${error.message}`, { cause: error }); }
 const crons = config.triggers?.crons;
 if (crons === undefined) return undefined;
 if (!Array.isArray(crons) || crons.some(cron => typeof cron !== 'string')) throw new Error(`${path} triggers.crons must be a list of cron expressions.`);
 return crons;
}

// Every file of the discovery that declares triggers.crons, as { path, crons }.
export async function declaredCronSources(root, adapter) {
 const found = [];
 for (const path of deployConfigPaths(adapter)) {
  let source;
  try { source = await readFile(await contained(root, path, { optional: true }), 'utf8'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  const crons = /\.toml$/.test(path) ? tomlCrons(source, path) : jsoncCrons(source, path);
  if (crons !== undefined) found.push({ path, crons });
 }
 return found;
}
