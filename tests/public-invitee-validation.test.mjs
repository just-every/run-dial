import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { contract } from "./contract.mjs";
const result = await build({ stdin: { contents: 'export * from "./src/core/features/public-booking/ui/details-validation"; export * from "./src/core/features/public-booking/ui/timezone-search";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
const { detailsErrors, searchTimezones, validTimezone } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
contract("AVAIL-005", "timezone search resolves spaced city names and rejects unknown zones without a substitute", () => {
  assert.ok(searchTimezones("new york").includes("America/New_York"));
  assert.deepEqual(searchTimezones("Mars/Olympus"), []);
  for (const zone of ["Mars/Olympus", "", "UTC+10", "America/Invalid"]) assert.equal(validTimezone(zone), undefined);
  assert.equal(validTimezone(" Australia/Brisbane "), "Australia/Brisbane");
});
contract("EVENT-003", "details validation names each required field and validates required choice groups", () => {
  const questions = [{ key: "agenda", label: "Agenda", kind: "text", required: true, options: [] }, { key: "choices", label: "Goals", kind: "multiple_choice", required: true, options: [{ value: "focus", label: "Focus" }] }, { key: "optional", label: "Optional", kind: "textarea", required: false, options: [] }];
  assert.deepEqual(detailsErrors(" ", "invalid", questions, {}), { name: "Enter your name.", email: "Enter a valid email address.", "question:agenda": "Complete Agenda.", "question:choices": "Choose at least one option for Goals." });
  assert.deepEqual(detailsErrors("Invitee", "invitee@dial.test", [{ ...questions[0], key: "name" }], {}), { "question:name": "Complete Agenda." });
  assert.deepEqual(detailsErrors("Invitee", "invitee@dial.test", questions, { agenda: "Talk", choices: ["focus"] }), {});
});
contract("BOOK-007", "public booking sources contain no typed datetime-local reschedule path", async () => {
  async function check(directory) { for (const file of await readdir(directory, { withFileTypes: true })) { const path = `${directory}/${file.name}`; if (file.isDirectory()) await check(path); else assert.doesNotMatch(await readFile(path, "utf8"), /datetime-local/, path); } }
  await check("src/core/features/public-booking");
});
