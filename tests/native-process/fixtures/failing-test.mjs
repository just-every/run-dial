import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnOwned } from "../lifecycle.mjs";

test("the original failure remains visible after teardown of an already exited process", async (context) => {
  const owned = spawnOwned(process.execPath, [new URL("./process.mjs", import.meta.url).pathname, "signal-parent"], {});
  context.after(() => owned.stop());
  await owned.exited;
  assert.fail("underlying fixture assertion");
});
