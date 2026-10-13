import type { Plugin } from "vite";

const moduleId = "virtual:dial-build-assets";
const resolvedId = `\0${moduleId}`;

// Start builds the client before the Worker. Carry only that build's emitted,
// fingerprinted JavaScript into the Worker; CSS and public-directory files are absent.
export function buildAssets(): Plugin {
  let building = false;
  let assetPaths: string[] | undefined;
  return {
    name: "dial-build-assets",
    sharedDuringBuild: true,
    configResolved(config) { building = config.command === "build"; },
    resolveId(id) { if (id === moduleId) return resolvedId; },
    load(id) {
      if (id !== resolvedId) return;
      if (building && !assetPaths) this.error("Dial build assets require the client build before the Worker build.");
      return `export default new Set(${JSON.stringify(building ? assetPaths : [])});`;
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        if (this.environment.name !== "client") return;
        const paths = new Set<string>();
        for (const output of Object.values(bundle)) {
          if (output.type !== "chunk") continue;
          if (output.fileName.startsWith("assets/") && output.fileName.endsWith(".js") && output.preliminaryFileName !== output.fileName) paths.add(`/${output.fileName}`);
        }
        assetPaths = [...paths].sort();
      },
    },
  };
}
