import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { evidencePath } from "../scripts/evidence-path.mjs";
import { contract } from "./contract.mjs";

// One ordered lifecycle through public doors, with rer's scheduler (the Cron schedule `rer dev` runs) as the only trigger
// of reminders, retries, connection alerts and calendar sync. scripts/verify-lifecycle-journey.mjs names every step.
let lifecycle;
const journey = () => lifecycle ??= runLifecycle();
async function runLifecycle() {
  const child = spawn(process.execPath, ["scripts/verify-lifecycle-journey.mjs"], { cwd: new URL("../", import.meta.url), env: { ...process.env, DIAL_EVIDENCE_FILE: evidencePath("lifecycle-journey.json") }, stdio: "pipe" });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
  const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
  assert.equal(code, 0, output.slice(-12000));
}

contract("NOTIFY-003", "a booking lifecycle runs end to end on rer's schedule: race, reschedule, cancel, replay, calendar outage, throttled mail, external deletion and on-time reminders", journey);
contract("CAL-006", "journey 6c records named health transitions and restores full sync and fresh availability after lapsed or unrenewable channels while early renewal keeps its cursor", journey);
