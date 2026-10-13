import { evidencePath } from "./evidence-path.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { verifyNative } from "../tests/public-admission/native.mjs";
import { call, expire, origin, state } from "../tests/public-admission/helpers.mjs";

try {
  if (process.argv[2] === "--before-restart") await verifyNative();
  else if (process.argv[2] === "--after-restart") {
    const previous = JSON.parse(await readFile(evidencePath("public-admission-native.json"), "utf8"));
    assert.ok(Date.now() - previous.restartPreloadedAt < 60000, "restart must exercise the still-live minute budget");
    for (const path of ["/api/public/events/dial-host/intro", "/assets/admission-missing.js", "/_serverFn/admission-missing"]) {
      const refusal = await call(path, undefined, 429, { "CF-Connecting-IP": previous.restartIp });
      assert.ok(Number(refusal.headers.get("Retry-After")) >= 1);
      assert.equal(refusal.headers.get("Cache-Control"), "no-store");
    }
    await call("/api/public/events/dial-host/intro", undefined, 200, { "CF-Connecting-IP": "198.51.100.78" });
    const checks = [...previous.checks, "process restart preserves the live budget for public API, declared assets and registered Start transport paths; another client remains admitted"];
    console.log(`PASS ${checks.at(-1)}`);
    await expire(); assert.equal((await state()).rates.length, 0);
    await writeFile(evidencePath("public-admission.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), origin, providers: "task-owned synthetic calendar and mail", checks, limits: [...previous.limits, "Public confirmation and reviewed-alternative browser429 retention/retry remain pending under the explicit browser launch hold. No browser was launched by this fixture."] }, null, 2) + "\n");
  } else throw new Error("Use --before-restart or --after-restart; browser launches are held.");
} catch (error) {
  await writeFile(evidencePath("public-admission-failure.json"), JSON.stringify({ observedAt: new Date().toISOString(), origin, phase: process.argv[2], failure: error.message, stack: error.stack }, null, 2) + "\n");
  throw error;
}
