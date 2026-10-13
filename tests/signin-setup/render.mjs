import { build } from "esbuild";

// Test-only SSR host: both the page and its Base-derived options are production code.
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import { renderToStaticMarkup } from "react-dom/server";
    import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
    import { SignInPage } from "./src/core/features/operators/ui/sign-in-page";
    import { signinOptions } from "./src/core/features/operators/signin-options";
    export async function render(bindings) {
      const options = await signinOptions(bindings);
      const router = createRouter({ routeTree: createRootRoute({ component: () => <SignInPage options={options} /> }), history: createMemoryHistory({ initialEntries: ["/signin"] }) });
      await router.load();
      return { options, html: renderToStaticMarkup(<RouterProvider router={router} />) };
    }
  ` },
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
  banner: { js: `import { createRequire } from "node:module"; const require = createRequire(${JSON.stringify(new URL("../../package.json", import.meta.url).pathname)});` },
});
export const { render } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
