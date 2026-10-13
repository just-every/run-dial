import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig, loadConfigFromFile } from "vite";
import { unstable_readConfig } from "wrangler";
import { workerSourceFiles } from "./vite-worker-files.mjs";

// Only maintained native test rigs opt into this config. Production's config and
// deny rules remain authoritative; the extra grants are individual source files.
export default defineConfig(async (environment) => {
  if (environment.command !== "serve") throw new Error("The native test rig config is serve-only.");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const loaded = await loadConfigFromFile(environment, resolve(root, "vite.config.ts"), root);
  if (!loaded) throw new Error("The product Vite configuration is missing.");
  const worker = unstable_readConfig({ config: process.env.DIAL_WRANGLER_CONFIG_PATH ?? "wrangler.toml", env: process.env.CLOUDFLARE_ENV });
  if (!worker.main) throw new Error("The native test rig requires a configured Worker entry.");
  const files = await workerSourceFiles(root, worker.main);
  const config = loaded.config;
  return {
    ...config,
    server: {
      ...config.server,
      fs: { ...config.server?.fs, allow: [...(config.server?.fs?.allow ?? []), ...files] },
    },
  };
});
