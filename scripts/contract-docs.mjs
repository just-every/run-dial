import { readFile, writeFile } from "node:fs/promises";
import { validateContractStatus } from "./contract-status.mjs";

const [command, ...ids] = process.argv.slice(2);
if (!["write", "check"].includes(command)) throw new Error("Expected write or check, followed by touched clause IDs");
const root = process.cwd();
let contract = await readFile("CONTRACT.md", "utf8");
const rows = contract.split("\n").filter(line => /^\| `[A-Z][A-Z-]*-\d{3}` \|/.test(line)).map(line => line.split("|").slice(1, -1).map(cell => cell.trim()));
const counts = subset => ["done", "partial", "missing"].map(status => subset.filter(row => row[3] === status).length);
for (const [label, subset] of [["Published", rows.filter(row => row[2] === "published")], ["Target and push further", rows.filter(row => row[2] !== "published")], ["All", rows]]) {
  contract = contract.replace(new RegExp(`^\\| ${label} \\|.*$`, "m"), `| ${label} | ${counts(subset).join(" | ")} | ${subset.length} |`);
}
let acceptance = await readFile("ACCEPTANCE.md", "utf8"), claims = await readFile("docs/CLAIMS.md", "utf8");
for (const id of ids) {
  const row = rows.find(row => row[0] === `\`${id}\``);
  if (!row) throw new Error(`Unknown clause ${id}`);
  const clause = contract.split("\n").find(line => line.startsWith(`- **${id} —`));
  if (!clause?.includes("*Acceptance:*")) throw new Error(`Missing acceptance for ${id}`);
  acceptance = acceptance.replace(new RegExp(`^\\| ${id} —.*$`, "m"), `| ${id} — ${row[1]} | ${clause.split("*Acceptance:*")[1].trim()} | ${row[4] || "—"} | ${row[3][0].toUpperCase() + row[3].slice(1)} |`);
  const summary = `${id} is ${row[3]}. ${row[5] || "Each acceptance point is covered by the named native journeys."}\n\nEvidence: ${row[4] || "No passing proof yet."}`;
  const marker = `<!-- generated-clause:${id} -->`, end = `<!-- end-generated-clause:${id} -->`;
  if (claims.includes(marker)) {
    const start = claims.indexOf(marker), finish = claims.indexOf(end, start) + end.length;
    claims = claims.slice(0, start) + `${marker}\n${summary}\n${end}` + claims.slice(finish);
  } else claims += `\n\n${marker}\n${summary}\n${end}\n`;
}
const total = counts(rows);
acceptance = acceptance.replace(/Counts: \d+ clauses — \d+ done, \d+ partial, \d+ missing\./, `Counts: ${rows.length} clauses — ${total[0]} done, ${total[1]} partial, ${total[2]} missing.`);
claims = claims.replace(/The contract census is \d+ done \/ \d+ partial \/ \d+ missing \(\d+ clauses\)/, `The contract census is ${total[0]} done / ${total[1]} partial / ${total[2]} missing (${rows.length} clauses)`);
for (const [path, value] of [["CONTRACT.md", contract], ["ACCEPTANCE.md", acceptance], ["docs/CLAIMS.md", claims]]) {
  if (command === "write") await writeFile(path, value);
  else if (await readFile(path, "utf8") !== value) throw new Error(`Generated contract view is stale: ${path}`);
}
await validateContractStatus(root, contract, rows.map(row => row[0].replaceAll("`", "")));
console.log(`Contract documents ${command} passed for ${ids.join(", ") || "the current census"}.`);
