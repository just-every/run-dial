import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

let source;
async function entry() {
  source ??= build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import { createRoot } from "react-dom/client";
    import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
    import { SignInPage } from "./src/core/features/operators/ui/sign-in-page";
    const router = createRouter({ routeTree: createRootRoute({ component: () => <SignInPage options={{ setup: true, developmentOutbox: false, setupInstructions: "Use your configured SETUP_TOKEN." }} /> }), history: createMemoryHistory({ initialEntries: ["/"] }) });
    await router.load();
    createRoot(document.getElementById("root")).render(<RouterProvider router={router} />);
  ` }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic" });
  return (await source).outputFiles[0].text;
}

export async function signInBrowser(context, native) {
  const javascript = await entry();
  const browser = await chromium.launch({ headless: true });
  context.after(async () => { await browser.close(); assert.equal(browser.isConnected(), false); });
  const page = await browser.newPage();
  const errors = [], requests = [];
  page.on("pageerror", () => errors.push("page error"));
  page.on("console", message => { if (message.type() === "error") errors.push("console error"); });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    // Every browser request is intercepted; only the real sign-in route is run.
    if (url.origin !== "http://127.0.0.1:8787") { errors.push("external request"); return route.abort(); }
    if (url.pathname === "/api/auth/magic-links") {
      requests.push(request.postDataJSON());
      const response = await native.send(url.pathname, request.postDataJSON());
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    }
    if (url.pathname === "/entry.js") return route.fulfill({ contentType: "text/javascript", body: javascript });
    if (url.pathname === "/signin") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><head><title>Sign in</title></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>' });
    errors.push("unexpected request"); return route.abort();
  });
  await page.goto("http://127.0.0.1:8787/signin");
  return { page, errors, requests };
}
