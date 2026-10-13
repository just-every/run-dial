import assert from "node:assert/strict";
import { build } from "esbuild";
import test from "node:test";
import { configure } from "../modules/operator-auth/config.mjs";

test("preview and production operator cookies require secure transport", async () => {
  const cookieModule = await loadCookieModule();
  const secret = "s".repeat(32);
  const preview = configure({ origin: "https://preview.dial.example", OWNER_EMAIL: "owner@dial.example", SESSION_SECRET: secret });
  const production = configure({ origin: "https://dial.example", OWNER_EMAIL: "owner@dial.example", SESSION_SECRET: secret });
  const development = configure({ local: true, origin: "http://127.0.0.1:8787", OWNER_EMAIL: "owner@dial.example", SESSION_SECRET: secret });

  assert.match(cookieModule.sessionCookie("token", preview), /; Secure$/);
  assert.match(cookieModule.sessionCookie("", preview, 0), /; Secure$/);
  assert.match(cookieModule.sessionCookie("token", production), /; Secure$/);
  assert.doesNotMatch(cookieModule.sessionCookie("token", development), /; Secure/);
});

async function loadCookieModule() {
  const result = await build({
    entryPoints: [new URL("../modules/operator-auth/http.mjs", import.meta.url).pathname],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`);
}
