import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { validateContractStatus } from './contract-status.mjs';

// The legacy contract keeps its established document layout until ct's rewrite.
// Regenerate only the named clause views; always recount the whole source.
const root=process.cwd(),[command,...args]=process.argv.slice(2);
if(!['write','check'].includes(command)||args.length&&args[0]!=='--clauses')throw new Error('Use contract-docs.mjs write or check, optionally --clauses followed by clause IDs.');
const ids=args.slice(1),contract=await readFile('CONTRACT.md','utf8');
const rows=contract.split('\n').filter(line=>/^\| `[A-Z][A-Z-]*-\d{3}` \|/u.test(line)).map(line=>line.split('|').slice(1,-1).map(cell=>cell.trim()));
const clauses=[...contract.matchAll(/^- \*\*([A-Z][A-Z-]*-\d{3}) — ([\s\S]*?)(?=\n- \*\*|\n##|$)/gmu)];
let acceptance=await readFile('ACCEPTANCE.md','utf8'),claims=await readFile('docs/CLAIMS.md','utf8');
for(const id of ids){
 const row=rows.find(row=>row[0]===`\`${id}\``),clause=clauses.find(clause=>clause[1]===id);assert.ok(row&&clause,`Unknown clause ${id}`);
 const proof=clause[2].split('*Acceptance:*')[1]?.trim();assert.ok(proof,`${id} needs its source acceptance`);
 const view=`| ${id} — ${row[1]} | ${proof.replaceAll('|','&#124;')} | — | ${row[3][0].toUpperCase()+row[3].slice(1)} |`;
 acceptance=acceptance.split('\n').map(line=>line.startsWith(`| ${id} — `)?view:line).join('\n');
 const claim=`${id} is ${row[3]}. ${row[3]==='done'?'':`Remaining: ${row[5]} `}Evidence: ${row[4]}.`;
 const lines=claims.split('\n'),index=lines.findIndex(line=>line.startsWith(`${id} is `));if(index<0)lines.push('',claim);else lines[index]=claim;claims=lines.join('\n');
}
const counts=['done','partial','missing'].map(status=>rows.filter(row=>row[3]===status).length);
acceptance=acceptance.replace(/Counts: \d+ clauses — \d+ done, \d+ partial, \d+ missing\./u,`Counts: ${rows.length} clauses — ${counts[0]} done, ${counts[1]} partial, ${counts[2]} missing.`);
claims=claims.replace(/The contract census is \d+ done \/ \d+ partial \/ \d+ missing \(\d+ clauses\)/u,`The contract census is ${counts[0]} done / ${counts[1]} partial / ${counts[2]} missing (${rows.length} clauses)`);
if(command==='write')await Promise.all([writeFile('ACCEPTANCE.md',acceptance),writeFile('docs/CLAIMS.md',claims)]);
else{assert.equal(await readFile('ACCEPTANCE.md','utf8'),acceptance,'Regenerate acceptance');assert.equal(await readFile('docs/CLAIMS.md','utf8'),claims,'Regenerate claims');}
await validateContractStatus(root,contract,rows.map(row=>row[0].replaceAll('`','')));
console.log(`Contract views ${command}: ${rows.length} clauses, ${counts.join(', ')}.`);
