import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { docsSite } from "./src/core/features/public-site/docs/build/plugin.ts";
import { readRepository } from "./src/core/features/public-site/docs/build/site.ts";
import { buildAssets } from "./scripts/build-assets";
import { retireLocalObservability } from "./scripts/local/observability.mjs";
import { archiveOutputGuard } from "./scripts/base-onboarding/archive-output.mjs";

const persistState = process.env.DIAL_PERSIST_STATE_DIR ? { path: process.env.DIAL_PERSIST_STATE_DIR } : true;
const wranglerConfig = process.env.DIAL_WRANGLER_CONFIG_PATH ?? "wrangler.toml";
const inspectorPort = process.env.DIAL_DISABLE_INSPECTOR === "1" ? false : process.env.DIAL_INSPECTOR_PORT ? Number(process.env.DIAL_INSPECTOR_PORT) : undefined;
const cloudflareEnv = process.env.CLOUDFLARE_ENV ?? "";

// Erasure imports the maintained portability runtime. Admit its exact SSR graph,
// keeping the CLI, other scripts and private repository files outside this allowlist.
const portabilityRuntimeFiles = [
  "scripts/base-cli/modules/portability/bridge.mjs",
  "scripts/base-cli/modules/portability/catalogue.mjs",
  "scripts/base-cli/modules/portability/copies.mjs",
  "scripts/base-cli/modules/portability/dev-data.mjs",
  "scripts/base-cli/modules/portability/export.mjs",
  "scripts/base-cli/modules/portability/format.mjs",
  "scripts/base-cli/modules/portability/generated.mjs",
  "scripts/base-cli/modules/portability/hash.mjs",
  "scripts/base-cli/modules/portability/http.mjs",
  "scripts/base-cli/modules/portability/import.mjs",
  "scripts/base-cli/modules/portability/index.mjs",
  "scripts/base-cli/modules/portability/journal.mjs",
  "scripts/base-cli/modules/portability/legacy-safety.mjs",
  "scripts/base-cli/modules/portability/lines.mjs",
  "scripts/base-cli/modules/portability/migration-statements.mjs",
  "scripts/base-cli/modules/portability/payloads.mjs",
  "scripts/base-cli/modules/portability/provider-data.mjs",
  "scripts/base-cli/modules/portability/restore-safety.mjs",
  "scripts/base-cli/modules/portability/storage.mjs",
];

// `rer dev` hands the checkout's dev key to `vite dev` alone, which then loads the local-only entry (the dev identity layer). A
// build keeps the deployed Worker entry and never sees the key, and `rer build` checks its output for the layer.
// Absolute: an isolated Worker configuration lives in another directory, and `main` resolves against it.
const devEntry = fileURLToPath(new URL("./src/server.dev.ts", import.meta.url));
const devKey = process.env.RER_DEV_KEY ? { RER_DEV_KEY: process.env.RER_DEV_KEY, RER_DEV_IDENTITY: process.env.RER_DEV_IDENTITY ?? "on" } : undefined;

async function runtimeCacheDir(command: "build" | "serve") {
  if (command !== "serve" || (wranglerConfig === "wrangler.toml" && !cloudflareEnv)) return undefined;

  // Isolated Worker configurations must not race on Vite's shared deps_ssr cache.
  const identity = `${wranglerConfig}\0${cloudflareEnv}`;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  const suffix = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
  return `node_modules/.vite/dial-${suffix}`;
}

export default defineConfig(async ({ command }) => {
  // The Cloudflare plugin reads the rendered Worker configuration. rer resolves this config to check archive paths before
  // any build, so render it here when a checkout has never built, exactly as build:app does.
  if (wranglerConfig === "wrangler.toml" && !existsSync(fileURLToPath(new URL("./wrangler.toml", import.meta.url)))) await import(new URL("./scripts/render-wrangler.mjs", import.meta.url).href);
  if (command === "serve") {
    // The SDK otherwise persists request URLs independently of application erasure.
    // Cover direct Vite invocations as well as the RER lifecycle's prepare hook.
    process.env.X_LOCAL_OBSERVABILITY = "false";
    process.env.X_LOCAL_EXPLORER = "false";
    await retireLocalObservability(process.cwd(), process.env.DIAL_PERSIST_STATE_DIR ?? ".wrangler/state");
  }
  const cacheDir = await runtimeCacheDir(command);
  return {
    ...(cacheDir ? { cacheDir } : {}),
    // The repository URL from package.json, for the public site's Source links (the Worker serves no file from the project root).
    define: { __DIAL_SOURCE_URL__: JSON.stringify(readRepository(process.cwd()).url) },
    // Workerd requests SSR imports through Vite too; allow the imported shared modules
    // and the public capacity manifest without exposing the repository root.
    server: { fs: { strict: true, allow: ["src", "public", "node_modules", "modules/editor", "modules/operator-auth", "modules/owner-claim", "modules/mail", "modules/local-signin", "modules/import-kit", "seed.json", "deploy-site.json", ...portabilityRuntimeFiles], deny: ["**/.rer/**", "**/.seed/**", "**/exports/**", "**/*.rer"] } },
    plugins: [cloudflare({ config: command === "serve" ? (config) => ({ ...(process.env.RER_DEV_ORIGIN ? { vars: { ...config.vars, APP_URL: process.env.RER_DEV_ORIGIN, ...devKey } } : {}), ...(devKey ? { main: devEntry } : {}), assets: { ...config.assets, run_worker_first: ["/*", "!/@*", "!/src/*", "!/node_modules/*", "!/modules/editor/*"] } }) : undefined, configPath: wranglerConfig, persistState, inspectorPort, viteEnvironment: { name: "ssr" } }), docsSite(), tanstackStart({ prerender: { enabled: false } }), react(), tailwindcss(), buildAssets(), archiveOutputGuard()],
  };
});
