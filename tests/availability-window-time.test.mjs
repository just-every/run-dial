import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contract } from "./contract.mjs";

const directory = await mkdtemp(resolve(tmpdir(), "dial-window-time-"));
let clock;
try {
  const output = resolve(directory, "clock.mjs");
  await build({ entryPoints: [new URL("../src/core/features/event-types/ui/window-time.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", outfile: output, logLevel: "silent" });
  clock = await import(pathToFileURL(output).href);
} finally { await rm(directory, { recursive: true, force: true }); }

contract("EVENT-002", "host window inputs retain every valid minute and exclusive next midnight", () => {
  for (let minute = 0; minute < 1440; minute += 1) {
    const input = clock.timeInput(minute);
    assert.match(input, /^(?:[01]\d|2[0-3]):[0-5]\d$/);
    assert.equal(clock.timeMinutes(input), minute);
    if (minute > 0) assert.equal(clock.timeMinutes(input, true), minute);
  }
  assert.equal(clock.timeInput(1440), "00:00");
  assert.equal(clock.timeMinutes("00:00", true), 1440);
  assert.equal(clock.timeMinutes("00:00"), 0);
  assert.equal(clock.boundaryLabel(1440), "24:00");
});

contract("EVENT-002", "cleared and malformed time inputs stay invalid instead of silently becoming midnight", () => {
  for (const value of ["", "24:00", "12:60", "9:00", "12:30:00", "00:00 ", "-1:00"]) {
    assert.ok(Number.isNaN(clock.timeMinutes(value)));
    assert.ok(Number.isNaN(clock.timeMinutes(value, true)));
  }
  assert.equal(clock.timeInput(Number.NaN), "");
  assert.equal(clock.timeInput(Infinity), "");
});
