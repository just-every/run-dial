import { readFile, writeFile } from "node:fs/promises";
import { parseContract } from "../src/base/seed-contract.mjs";

// Generate this edition's retained table format without converting its contract.
const command=process.argv[2],args=process.argv.slice(3);
if(!["write","check"].includes(command)||(args.length&&args[0]!=="--clauses"))throw new Error("Usage: node scripts/contract-docs.mjs write|check [--clauses ID ...]");
const source=await readFile("CONTRACT.md","utf8"),parsed=parseContract(source.replace(/\| Clauses \| Done \| Partial \| Missing \| Total \|\n(?:\|[^\n]*\|\n){4}/, block=>block.replace(/[^\n]/g,"")));
const lines=source.split("\n"),rows=parsed.clauses.map(clause=>({clause,cells:lines[clause.row-1].split("|").slice(1,-1).map(cell=>cell.trim())}));
const counts=kind=>["done","partial","missing"].map(status=>rows.filter(row=>(!kind||row.clause.kind===kind)&&row.clause.status===status).length);
for(const id of args.slice(1))if(!parsed.clauses.some(clause=>clause.id===id))throw new Error(`Unknown clause ${id}`);
const all=counts(),published=counts("published"),target=all.map((value,index)=>value-published[index]);
const summary=["| Clauses | Done | Partial | Missing | Total |","| --- | ---: | ---: | ---: | ---: |",...[["Published",published],["Target and push further",target],["All",all]].map(([name,values])=>`| ${name} | ${values.join(" | ")} | ${values.reduce((sum,value)=>sum+value,0)} |`)].join("\n");
const contract=source.replace(/\| Clauses \| Done \| Partial \| Missing \| Total \|\n(?:\|[^\n]*\|\n){4}/,summary+"\n");
const display=value=>value.replace(/([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g, "$1 [at] $2");
const marker="<!-- Generated from CONTRACT.md by contract-docs. Edit CONTRACT.md, then regenerate. -->";
const acceptance=[marker,"# Dial acceptance",`Counts: ${rows.length} clauses — ${all[0]} done, ${all[1]} partial, ${all[2]} missing.`,"CONTRACT.md is the source of requirements, acceptance and status. Every row below retains its acceptance text; provider and role boundaries remain in the source clause.","| Clause | Acceptance | Status |","| --- | --- | --- |",...rows.map(({clause})=>{
 const text=lines[clause.line-1],acceptance=text.includes("*Acceptance:*")?text.split("*Acceptance:*").slice(1).join("*Acceptance:*").trim():clause.body;
 return `| ${clause.id} — ${clause.title} | ${String(acceptance??text).replaceAll("|","\\|")} | ${clause.status} |`;
})].join("\n\n").replace(/\|\n\n\|/g,"|\n|")+"\n";
const claims=[marker,"# Implemented contract claims",`The contract census is ${all[0]} done / ${all[1]} partial / ${all[2]} missing (${rows.length} clauses).`,`Read each claim with its full requirement and acceptance in [CONTRACT.md](../CONTRACT.md). A partial or missing claim keeps its remaining work explicit.`,...rows.map(({clause,cells})=>`${clause.id} is ${clause.status}: ${clause.title}.\n\nEvidence: ${cells[4]||"None."}\n\nGap: ${cells[5]||"None."}`)].join("\n\n")+"\n";
for(const [path,value] of [["CONTRACT.md",contract],["ACCEPTANCE.md",display(acceptance)],["docs/CLAIMS.md",display(claims)]]) {
 const current=await readFile(path,"utf8");
 if(command==="check"&&current!==value)throw new Error(`${path}: generated content differs; run contract-docs write.`);
 if(command==="write"&&current!==value)await writeFile(path,value);
}
console.log(command==="check"?"Contract documents are current.":"Contract documents regenerated.");
