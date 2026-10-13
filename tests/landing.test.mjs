import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { contract } from "./contract.mjs";

// HOME-001. The landing at `/`, server-rendered through a router the way the Worker renders it, with and without a host profile.
const sourceUrl = "https://github.com/just-every/run-dial";
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import { renderToString } from "react-dom/server";
    import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
    import { Landing } from "./src/core/features/public-site/landing/Landing";
    import { DocumentData } from "./src/core/app/document-data";
    import { clientMount } from "./src/core/app/public-mount";
    export { clientMount };
    export async function render(payload) {
      const root = createRootRoute({ component: () => <DocumentData.Provider value={{ status: 200, payload }}><Outlet /></DocumentData.Provider> });
      const routes = [createRoute({ getParentRoute: () => root, path: "/", component: Landing }), ...["/docs", "/docs/$slug", "/signin", "/book/$handle"].map((path) => createRoute({ getParentRoute: () => root, path, component: () => null }))];
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
const { render, clientMount } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const profile = { handle: "maya-chen", name: "Maya Chen", title: "Advisor", timezone: "UTC", socialProof: [] };
const text = (html) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const hrefs = (html) => [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((match) => match[1]);

const sectionsOf = (html) => [...html.matchAll(/<section\b[^>]*\baria-labelledby="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)].map((match) => ({ labelledby: match[1], html: match[2] }));
const contentSections = ["invitees", "host", "essentials", "requests", "yours", "closing"].map((name) => `${name}-title`);

contract("HOME-001", "the landing renders one h1, its six sections in order, each named by an h2, and links to sign in, the docs and the install guide", async () => {
  const html = await render(null);
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
  for (const path of ["/signin", "/docs", "/docs/install", sourceUrl]) assert.ok(links.includes(path), `links to ${path}`);
  for (const id of ["hero-title", "closing-title"]) assert.ok(hrefs(sections.find((section) => section.labelledby === id).html).includes("/docs/install"), `${id} section links to the install guide`);
  assert.match(html, /<footer/);
});

contract("HOME-001", "the host's booking-profile link appears only when a profile is configured", async () => {
  const without = await render(null);
  assert.doesNotMatch(without, /host-chip-link/);
  assert.ok(!hrefs(without).some((href) => href.startsWith("/book/")), "no booking link without a profile");
  const html = await render({ profile, eventTypes: [] });
  const link = html.match(/<a\b[^>]*class="host-chip-link"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(link, "the booking-profile link is rendered");
  assert.match(link[0], /href="\/book\/maya-chen"/);
  assert.notEqual(text(link[1]).trim(), "", "the link has text");
});

contract("HOME-001", "the footer shows a configured owner identity, none for an unnamed install, and the credit follows showPoweredBy", async (t) => {
  const configured = clientMount.deploymentConfig;
  t.after(() => { clientMount.deploymentConfig = configured; });
  const footerOf = (html) => text(html.match(/<footer[\s\S]*<\/footer>/)[0]);
  const mentions = (html, name) => footerOf(html).split(name).length - 1;
  const credit = (html) => hrefs(html).includes("https://runeditrun.com");
  clientMount.deploymentConfig = { ...configured, owner: { name: "Chen Consulting" }, description: "Advice for small studios.", showPoweredBy: true };
  const credited = await render(null);
  assert.ok(footerOf(credited).includes("Chen Consulting") && footerOf(credited).includes("Advice for small studios."), "the configured owner and description are shown");
  assert.ok(credit(credited), "the credit link is shown when showPoweredBy is true");
  clientMount.deploymentConfig = { ...clientMount.deploymentConfig, showPoweredBy: false };
  const plain = await render(null);
  assert.ok(footerOf(plain).includes("Chen Consulting"), "the owner identity stays when the credit is off");
  assert.ok(!credit(plain), "no credit link when showPoweredBy is false");
  clientMount.deploymentConfig = { ...clientMount.deploymentConfig, owner: undefined };
  const unnamed = await render(null);
  assert.ok(footerOf(unnamed).includes("Advice for small studios."), "an unnamed install still shows its description");
  assert.equal(mentions(unnamed, "Dial"), mentions(plain, "Dial"), "an install with no owner adds no owner identity beside the Dial wordmark");
});

contract("HOME-001", "the landing loads only same-origin resources and keeps no cookie or browser storage", async () => {
  const html = await render({ profile, eventTypes: [] });
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
