import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { docsSite } from "./src/core/features/public-site/docs/build/plugin.ts";
import { readRepository } from "./src/core/features/public-site/docs/build/site.ts";
import { archiveSchema } from "./scripts/archive/schema-plugin";
import { buildAssets } from "./scripts/build-assets";
import { retireLocalObservability } from "./scripts/local/observability.mjs";
import { archiveOutputGuard } from "@runeditrun/rer/archive-output";
import { demoSockets } from "./src/modules/demo/vite.mjs";

// `rer demo` hands its throwaway state folder in RER_STATE_DIR, so a demo never opens this checkout's own state.
const stateDir = process.env.RER_STATE_DIR ?? process.env.DIAL_PERSIST_STATE_DIR;
const persistState = stateDir ? { path: stateDir } : true;
const wranglerConfig = process.env.DIAL_WRANGLER_CONFIG_PATH ?? "wrangler.toml";
const inspectorPort = process.env.DIAL_DISABLE_INSPECTOR === "1" ? false : process.env.DIAL_INSPECTOR_PORT ? Number(process.env.DIAL_INSPECTOR_PORT) : undefined;
const cloudflareEnv = process.env.CLOUDFLARE_ENV ?? "";

// Erasure imports the maintained portability runtime. Admit its exact SSR graph,
// keeping the CLI, other scripts and private repository files outside this allowlist.
const portabilityRuntimeFiles = [
  "scripts/archive/catalog.mjs", "scripts/archive/policy.mjs", "scripts/archive/import-policy.mjs",
  "scripts/archive/redaction.mjs", "scripts/archive/private-links.mjs", "scripts/archive/json-values.mjs",
  "scripts/archive/environment-secrets.mjs", "scripts/archive/export-policy.mjs", "scripts/archive/guarded-bucket.mjs",
  "scripts/archive/migration-ledger.mjs",
  "scripts/archive/secret-scanner.mjs", "scripts/archive/json-secret-scanner.mjs",
  "node_modules/@runeditrun/rer/modules/portability/bridge.mjs",
  "node_modules/@runeditrun/rer/modules/portability/catalogue.mjs",
  "node_modules/@runeditrun/rer/modules/portability/copies.mjs",
  "node_modules/@runeditrun/rer/modules/portability/dev-data.mjs",
  "node_modules/@runeditrun/rer/modules/portability/export.mjs",
  "node_modules/@runeditrun/rer/modules/portability/format.mjs",
  "node_modules/@runeditrun/rer/modules/portability/generated.mjs",
  "node_modules/@runeditrun/rer/modules/portability/hash.mjs",
  "node_modules/@runeditrun/rer/modules/portability/http.mjs",
  "node_modules/@runeditrun/rer/modules/portability/import.mjs",
  "node_modules/@runeditrun/rer/modules/portability/index.mjs",
  "node_modules/@runeditrun/rer/modules/portability/journal.mjs",
  "node_modules/@runeditrun/rer/modules/portability/legacy-safety.mjs",
  "node_modules/@runeditrun/rer/modules/portability/lines.mjs",
  "node_modules/@runeditrun/rer/modules/portability/migration-statements.mjs",
  "node_modules/@runeditrun/rer/modules/portability/payloads.mjs",
  "node_modules/@runeditrun/rer/modules/portability/provider-data.mjs",
  "node_modules/@runeditrun/rer/modules/portability/restore-safety.mjs",
  "node_modules/@runeditrun/rer/modules/portability/storage.mjs",
];

// `rer dev` hands the checkout's dev key to `vite dev` alone, which then loads the local-only entry (the dev identity layer). A
// build keeps the deployed Worker entry and never sees the key, and `rer build` checks its output for the layer.
// Absolute: an isolated Worker configuration lives in another directory, and `main` resolves against it.
const devEntry = fileURLToPath(new URL("./src/server.dev.ts", import.meta.url));
const devKey = process.env.RER_DEV_KEY ? { RER_DEV_KEY: process.env.RER_DEV_KEY, RER_DEV_IDENTITY: process.env.RER_DEV_IDENTITY ?? "on" } : undefined;
// `rer demo` (RER_DEMO=1) reaches the dev entry's vars with its end time; nothing else sets them.
const demo = process.env.RER_DEMO === "1" ? { RER_DEMO: "1", ...(process.env.RER_DEMO_EXPIRES ? { RER_DEMO_EXPIRES: process.env.RER_DEMO_EXPIRES } : {}) } : undefined;

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
    await retireLocalObservability(process.cwd(), stateDir ?? ".wrangler/state");
  }
  const cacheDir = await runtimeCacheDir(command);
  return {
    ...(cacheDir ? { cacheDir } : {}),
    // The repository URL from package.json, for the public site's Source links (the Worker serves no file from the project root).
    define: { __DIAL_SOURCE_URL__: JSON.stringify(readRepository(process.cwd()).url) },
    // Workerd requests SSR imports through Vite too; allow the imported shared modules
    // and the public capacity manifest without exposing the repository root.
    server: { fs: { strict: true, allow: ["src", "public", "node_modules", "modules/editor", "modules/operator-auth", "modules/owner-claim", "modules/mail", "modules/local-signin", "modules/import-kit", "seed.json", "deploy-site.json", "sample-data/dial-demo.ts", ...portabilityRuntimeFiles], deny: ["**/.rer/**", "**/.seed/**", "**/exports/**", "**/*.rer"] } },
    plugins: [demoSockets(), cloudflare({ config: command === "serve" ? (config) => ({ ...(process.env.RER_DEV_ORIGIN ? { vars: { ...config.vars, APP_URL: process.env.RER_DEV_ORIGIN, ...devKey, ...demo } } : {}), ...(devKey ? { main: devEntry } : {}), assets: { ...config.assets, run_worker_first: ["/*", "!/@*", "!/src/*", "!/node_modules/*", "!/modules/editor/*"] } }) : undefined, configPath: wranglerConfig, persistState, inspectorPort, viteEnvironment: { name: "ssr" } }), docsSite(), tanstackStart({ prerender: { enabled: false } }), react(), tailwindcss(), archiveSchema(), buildAssets(), archiveOutputGuard()],
  };
});
