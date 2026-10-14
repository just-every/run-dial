import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { contract } from "./contract.mjs";
import { stripComments } from "./html-text.mjs";

// HOME-001 adoption. The static marketing landing and the installed public chrome use their real renderers.
const sourceUrl = "https://github.com/just-every/run-dial";
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import { renderToString } from "react-dom/server";
    import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
    import { Landing } from "./src/core/features/public-site/landing/Landing";
    import { SiteFrame } from "./src/core/features/public-site/chrome/SiteFrame";
    import { SiteDeploymentContext } from "./src/core/features/public-site/chrome/context";
    import { clientMount } from "./src/core/app/public-mount";
    export { clientMount };
    export function render() { return renderToString(<Landing variant="site" />); }
    export async function renderFooter() {
      const root = createRootRoute({ component: () => <SiteDeploymentContext.Provider value={clientMount.deploymentConfig}><Outlet /></SiteDeploymentContext.Provider> });
      const routes = [createRoute({ getParentRoute: () => root, path: "/", component: () => <SiteFrame page="docs" className="dial-docs" skipTo="content"><main id="content" /></SiteFrame> }), ...["/docs", "/docs/$slug", "/signin"].map((path) => createRoute({ getParentRoute: () => root, path, component: () => null }))];
      const router = createRouter({ routeTree: root.addChildren(routes), history: createMemoryHistory({ initialEntries: ["/"] }) });
      await router.load();
      return renderToString(<RouterProvider router={router} />);
    }
  ` },
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
  loader: { ".css": "empty" },
  define: { __DIAL_SOURCE_URL__: JSON.stringify(sourceUrl) },
  banner: { js: `import {createRequire} from "node:module"; const require = createRequire(${JSON.stringify(process.cwd() + "/package.json")});` },
});
const { render, renderFooter, clientMount } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const text = (html) => stripComments(html).replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const hrefs = (html) => [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((match) => match[1]);

const sectionsOf = (html) => [...html.matchAll(/<section\b[^>]*\baria-labelledby="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)].map((match) => ({ labelledby: match[1], html: match[2] }));
const contentSections = ["invitees", "host", "essentials", "requests", "yours", "closing"].map((name) => `${name}-title`);

contract("HOME-001", "the run-site landing renders accessible ordered sections and public run, docs and source navigation", async () => {
  const html = await render();
  assert.equal(html.match(/<h1[\s>]/g)?.length, 1);
  assert.notEqual(text(html.match(/<h1[\s\S]*?<\/h1>/)[0]).trim(), "");
  const sections = sectionsOf(html);
  assert.deepEqual(sections.map((section) => section.labelledby).filter((id) => contentSections.includes(id)), contentSections, "the six content sections render in order");
  for (const section of sections.filter((entry) => contentSections.includes(entry.labelledby))) {
    const heading = section.html.match(/<h2\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/);
    assert.ok(heading, `${section.labelledby} has an h2`);
    assert.equal(heading[1], section.labelledby, "the section is named by its own h2");
    assert.notEqual(text(heading[2]).trim(), "", `${section.labelledby} h2 has text`);
  }
  assert.equal(html.match(/<h2[\s>]/g)?.length, contentSections.length, "every h2 belongs to a content section");
  const links = hrefs(html);
  for (const path of ["/docs", "/run", sourceUrl]) assert.ok(links.includes(path), `links to ${path}`);
  for (const id of ["hero-title", "closing-title"]) assert.ok(hrefs(sections.find((section) => section.labelledby === id).html).includes("/run"), `${id} section links to the run page`);
  assert.ok(!links.some(path => /^\/(signin|setup|app|auth|book)(\/|$)/.test(path)), "marketing navigation contains no instance routes");
  assert.match(html, /<footer/);
});

contract("HOME-001", "the installed public chrome footer shows a configured owner identity, none for an unnamed install, and the credit follows showPoweredBy", async (t) => {
  const configured = clientMount.deploymentConfig;
  t.after(() => { clientMount.deploymentConfig = configured; });
  const footerOf = (html) => text(html.match(/<footer[\s\S]*<\/footer>/)[0]);
  const mentions = (html, name) => footerOf(html).split(name).length - 1;
  const credit = (html) => hrefs(html).some((href) => href === "https://runeditrun.com");
  clientMount.deploymentConfig = { ...configured, owner: { name: "Chen Consulting" }, description: "Advice for small studios.", showPoweredBy: true };
  const credited = await renderFooter();
  assert.ok(footerOf(credited).includes("Chen Consulting") && footerOf(credited).includes("Advice for small studios."), "the configured owner and description are shown");
  assert.ok(credit(credited), "the credit link is shown when showPoweredBy is true");
  clientMount.deploymentConfig = { ...clientMount.deploymentConfig, showPoweredBy: false };
  const plain = await renderFooter();
  assert.ok(footerOf(plain).includes("Chen Consulting"), "the owner identity stays when the credit is off");
  assert.ok(!credit(plain), "no credit link when showPoweredBy is false");
  clientMount.deploymentConfig = { ...clientMount.deploymentConfig, owner: undefined };
  const unnamed = await renderFooter();
  assert.ok(footerOf(unnamed).includes("Advice for small studios."), "an unnamed install still shows its description");
  assert.equal(mentions(unnamed, "Dial"), mentions(plain, "Dial"), "an install with no owner adds no owner identity beside the Dial wordmark");
});

contract("HOME-001", "the landing loads only same-origin resources and keeps no cookie or browser storage", async () => {
  const html = await render();
  assert.doesNotMatch(html, /<(img|script|link|iframe|video|audio|object|embed)\b/, "drawings are inline; the document head adds the shared same-origin assets");
  assert.doesNotMatch(html, /\ssrc(set)?="/);
  const external = hrefs(html).filter((href) => /^[a-z]+:|^\/\//i.test(href));
  assert.deepEqual([...new Set(external)].sort(), [sourceUrl, "https://runeditrun.com"].sort(), "the only off-origin addresses are the Source and credit links");
  const files = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
  const sources = ["src/core/features/public-site/landing", "src/core/features/public-site/chrome", "src/core/shared/drawing"].flatMap(files).filter((file) => /\.(tsx?|css)$/.test(file));
  for (const file of sources) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /document\.cookie|localStorage|sessionStorage|indexedDB|navigator\.sendBeacon/, `${file} keeps no browser state`);
    for (const [, reference] of source.matchAll(/url\(\s*['"]?([^'")#][^'")]*)/g)) {
      assert.doesNotMatch(reference, /^[a-z]+:|^\/\//i, `${file} references only bundled files`);
      assert.ok(existsSync(resolve(dirname(file), reference)), `${file} references ${reference}, which exists`);
    }
  }
});
