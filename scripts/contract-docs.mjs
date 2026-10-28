import { readFile,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parseContract } from '../src/base/seed-contract.mjs';
import { validateContractStatus } from './contract-status.mjs';

// Preserve this seed's historical acceptance notes; derive its clause ledger and census from the source.
const [mode,...args]=process.argv.slice(2),touched=args.filter(value=>value!=='--touched');
if(!['write','check'].includes(mode))throw new Error('Use write or check, followed by --touched and clause IDs.');
const source=await readFile('CONTRACT.md','utf8'),rows=source.split('\n').filter(line=>/^\| `[A-Z][A-Z-]*-\d{3}` \|/.test(line)).map(line=>line.split('|').slice(1,-1).map(value=>value.trim()));
const tally=selected=>['done','partial','missing'].map(status=>selected.filter(row=>row[3]===status).length).concat(selected.length);
const summary=new Map([['Published',tally(rows.filter(row=>row[2]==='published'))],['Target and push further',tally(rows.filter(row=>row[2]!=='published'))],['All',tally(rows)]]);
let contract=source.split('\n').map(line=>{const label=line.split('|')[1]?.trim();return summary.has(label)?`| ${label} | ${summary.get(label).join(' | ')} |`:line;}).join('\n');
const parsed=parseContract(contract),ids=touched.length?touched:parsed.clauses.map(clause=>clause.id);
for(const id of ids)assert.ok(parsed.clauses.some(clause=>clause.id===id),`Unknown clause ${id}`);
let acceptance=await readFile('ACCEPTANCE.md','utf8'),claims=await readFile('docs/CLAIMS.md','utf8');
for(const clause of parsed.clauses.filter(clause=>ids.includes(clause.id))){
 const point=clause.text.split('*Acceptance:*')[1]?.split(/\*(?:Implementation|Remaining|Native|Policy):\*/)[0].trim();
 if(!point)throw new Error(`No acceptance text for ${clause.id}`);
 const row=rows.find(row=>row[0]===`\`${clause.id}\``),status=clause.status[0].toUpperCase()+clause.status.slice(1);
 acceptance=acceptance.split('\n').map(line=>line.startsWith(`| ${clause.id} —`)?`| ${clause.id} — ${clause.title} | ${point.replaceAll('|','&#124;')} | ${row[4]||'—'} | ${status} |`:line).join('\n');
}
const {done,partial,missing,total}=parsed.counts;
acceptance=acceptance.replace(/Counts: \d+ clauses — \d+ done, \d+ partial, \d+ missing\./,`Counts: ${total} clauses — ${done} done, ${partial} partial, ${missing} missing.`);
claims=claims.replace(/The contract census is \d+ done \/ \d+ partial \/ \d+ missing \(\d+ clauses\)/,`The contract census is ${done} done / ${partial} partial / ${missing} missing (${total} clauses)`);
const files=new Map([['CONTRACT.md',contract],['ACCEPTANCE.md',acceptance],['docs/CLAIMS.md',claims]]);
for(const [path,content]of files)if(mode==='write')await writeFile(path,content);else assert.equal(await readFile(path,'utf8'),content,`${path} needs contract-docs write`);
await validateContractStatus(process.cwd(),contract,parsed.clauses.map(clause=>clause.id));
console.log(`Contract documentation ${mode}: ${total} clauses, ${done} done, ${partial} partial, ${missing} missing.`);
