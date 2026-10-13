import { build } from "esbuild";

// Render the real page and router, including its real responsive shell.
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import { renderToStaticMarkup } from "react-dom/server";
    import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
    import { RequestOnlyPage } from "./src/core/features/public-booking/ui/request-only-page";
    export async function render(data, embedded) {
      const path = (embedded ? "/embed/" : "/book/") + data.profile.handle + "/" + data.eventType.slug + (embedded ? "?parent=https%3A%2F%2Fhost.example.test" : "");
      const router = createRouter({ routeTree: createRootRoute({ component: () => <RequestOnlyPage data={data} embedded={embedded} /> }), history: createMemoryHistory({ initialEntries: [path] }) });
      await router.load();
      return renderToStaticMarkup(<RouterProvider router={router} />);
    }
  ` },
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
  banner: { js: `import { createRequire } from "node:module"; const require = createRequire(${JSON.stringify(new URL("../../package.json", import.meta.url).pathname)});` },
});
export const { render } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
