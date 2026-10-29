import assert from "node:assert/strict";
import { build } from "esbuild";
import { contract } from "./contract.mjs";

contract("AVAIL-006", "invitee time labels distinguish fold instants and preserve their offsets in ranges", async () => {
  const bundled = await build({ entryPoints: ["src/core/features/public-booking/ui/invitee-time.ts"], bundle: true, write: false, platform: "node", format: "esm" });
  const { formatTime, format, formatRange } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
  const zone = "America/New_York", first = "2026-11-01T05:30:00Z", second = "2026-11-01T06:30:00Z", end = "2026-11-01T06:00:00Z";
  const offset = instant => new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date(instant)).find(part => part.type === "timeZoneName").value;
  assert.notEqual(formatTime(first, zone), formatTime(second, zone));
  for (const instant of [first, second, end]) {
    assert.ok(formatTime(instant, zone).includes(offset(instant)));
    assert.ok(format(instant, zone).includes(offset(instant)));
  }
  const range = formatRange(first, end, zone);
  for (const instant of [first, end]) assert.ok(range.includes(formatTime(instant, zone)), "both endpoints identify the instant when the clock moves backward");
  assert.doesNotMatch(formatTime("2026-11-02T15:00:00Z", zone), /GMT/);
});
