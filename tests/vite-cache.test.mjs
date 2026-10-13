import assert from "node:assert/strict";
import { loadConfigFromFile, resolveConfig } from "vite";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const configFile = resolve(root, "vite.config.ts");
const configA = resolve(root, "tests/dst-native/worker.wrangler.toml");
const configB = resolve(root, "tests/operator-management/worker.wrangler.toml");
const environmentKeys = ["DIAL_WRANGLER_CONFIG_PATH", "CLOUDFLARE_ENV"];

test("isolated native Vite runtimes get stable SSR caches without moving the default cache", async () => {
  const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  try {
    const defaultCache = await cacheDir(undefined, undefined, "serve");
    const repeatedDefaultCache = await cacheDir(undefined, undefined, "serve");
    assert.equal(defaultCache, resolve(root, "node_modules/.vite"));
    assert.equal(repeatedDefaultCache, defaultCache, "ordinary development keeps Vite's stable default cache");

    const firstRuntimeCache = await cacheDir(configA, undefined, "serve");
    const repeatedRuntimeCache = await cacheDir(configA, undefined, "serve");
    const secondRuntimeCache = await cacheDir(configB, undefined, "serve");
    const namedEnvironmentCache = await cacheDir(configA, "preview", "serve");
    assert.equal(repeatedRuntimeCache, firstRuntimeCache, "the same runtime identity reuses its cache across restarts");
    assert.notEqual(firstRuntimeCache, secondRuntimeCache, "different Wrangler configurations cannot share an SSR cache");
    assert.notEqual(firstRuntimeCache, namedEnvironmentCache, "different Cloudflare environments cannot share an SSR cache");

    const productionCache = await cacheDir(configA, undefined, "build");
    assert.equal(productionCache, defaultCache, "production builds keep the existing Vite cache location");
  } finally {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

async function cacheDir(configPath, cloudflareEnv, command) {
  if (configPath === undefined) delete process.env.DIAL_WRANGLER_CONFIG_PATH;
  else process.env.DIAL_WRANGLER_CONFIG_PATH = configPath;
  if (cloudflareEnv === undefined) delete process.env.CLOUDFLARE_ENV;
  else process.env.CLOUDFLARE_ENV = cloudflareEnv;

  const mode = command === "build" ? "production" : "development";
  const loaded = await loadConfigFromFile({ command, mode }, configFile, root, "silent");
  assert.ok(loaded, "the project Vite config loads");
  const defaultRuntime = configPath === undefined && cloudflareEnv === undefined;
  if (defaultRuntime || command === "build") assert.equal(loaded.config.cacheDir, undefined);
  const resolveWorkerPlugins = !defaultRuntime && cloudflareEnv === undefined;

  const resolved = await resolveConfig({
    ...loaded.config,
    configFile: false,
    root,
    ...(!resolveWorkerPlugins ? { plugins: [] } : {}),
  }, command, mode);
  return resolved.cacheDir;
}
