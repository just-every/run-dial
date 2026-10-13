import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { contract } from "./contract.mjs";

const data = {
  profile: { handle: "host", name: "Test Host", title: "Advisor", timezone: "UTC", socialProof: [] },
  eventType: { slug: "conversation", title: "Conversation", description: "Discuss a question.", bookingHorizonDays: 90, durationMinutes: 30, locationLabel: "Video call", alternativeRequestsEnabled: true, requestOnly: false },
};

contract("EVENT-006", "event entry switches modes without stale picker state, hook errors or request-only provider reads", async t => {
  const source = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
      import { PublicEventEntry } from "./src/core/features/public-booking/ui/event-entry";
      import { DocumentData } from "./src/core/app/document-data";
      function Screen() {
        const [props, setProps] = useState({ data: { ...${JSON.stringify(data)}, eventType: { ...${JSON.stringify(data.eventType)}, requestOnly: true } }, embedded: new URLSearchParams(location.search).get("embedded") === "true" });
        globalThis.setEventProps = setProps;
        return <DocumentData.Provider value={{status: 200, payload: null, renderInstant: "2026-10-05T00:00:00.000Z"}}><PublicEventEntry {...props} /></DocumentData.Provider>;
      }
      const routeTree = createRootRoute({ component: Screen });
      const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/?parent=https%3A%2F%2Fembed.test"] }) });
      await router.load();
      createRoot(document.getElementById("root")).render(<RouterProvider router={router} />);
    ` },
    bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
  });
  const reads = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/api/public/book/host/conversation/availability") {
      reads.push(url);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ state: "available", week: "2026-10-05", slots: [{ startAt: "2026-10-07T10:00:00.000Z", endAt: "2026-10-07T10:30:00.000Z", hostDate: "2026-10-07", hostOffset: "UTC+00:00" }], recommendations: [], rankedSlots: [{ startAt: "2026-10-07T10:00:00.000Z", endAt: "2026-10-07T10:30:00.000Z", hostDate: "2026-10-07", hostOffset: "UTC+00:00", reason: "Inside host working day" }] }));
    } else if (url.pathname === "/entry.js") {
      response.setHeader("content-type", "text/javascript");
      response.end(source.outputFiles[0].text);
    } else if (url.pathname === "/") {
      response.setHeader("content-type", "text/html");
      response.end('<!doctype html><html lang="en"><head><title>Event entry regression</title></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>');
    } else {
      response.writeHead(404); response.end();
    }
  });
  t.after(() => new Promise((done, reject) => server.close(error => error ? reject(error) : done())));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ timezoneId: "UTC" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const render = async (requestOnly, embedded, preview = false) => {
    await page.evaluate(props => globalThis.setEventProps(props), { data: { ...data, eventType: { ...data.eventType, requestOnly } }, embedded, preview });
    await page.getByRole("heading", { name: requestOnly ? "Request a time with Test Host." : "Choose a day and time.", exact: true }).waitFor();
    await page.evaluate(() => new Promise(done => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(done))));
  };
  for (const embedded of [false, true]) {
    const beforeInitial = reads.length;
    await page.goto(`${origin}/?embedded=${embedded}`);
    await render(true, embedded);
    assert.equal(reads.length, beforeInitial, "initial request-only render must not read availability");
    await render(false, embedded);
    await page.locator(".pb-slot-button").waitFor();
    const input = page.getByRole("combobox", { name: "View in timezone" });
    await input.fill("Australia/Brisbane"); await input.blur();
    await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(reads.at(-1).searchParams.get("inviteeTimezone"), "Australia/Brisbane");
    const beforeRequestOnly = reads.length;
    await render(true, embedded);
    assert.equal(await input.count(), 0);
    assert.equal(await page.locator(".pb-slot-button").count(), 0);
    assert.match(await page.locator("main").innerText(), /does not reserve a time or create a booking/);
    const link = new URL(await page.getByRole("link", { name: "Send another request", exact: true }).getAttribute("href"), origin);
    assert.equal(link.pathname, `/${embedded ? "embed" : "book"}/host/conversation/request`);
    assert.equal(link.searchParams.get("parent"), embedded ? "https://embed.test" : null);
    assert.equal(reads.length, beforeRequestOnly);
    await render(false, embedded);
    await page.locator(".pb-slot-button").waitFor();
    assert.equal(await input.inputValue(), "Australia/Brisbane", "mode change restores only the explicitly chosen zone from the URL");
    assert.equal(reads.length, beforeRequestOnly + 2, "restoring an authorized zone supersedes the initial host-only read exactly once");
    assert.equal(reads.at(-1).searchParams.get("inviteeTimezone"), "Australia/Brisbane");
    const beforeFresh = reads.length;
    await page.goto(`${origin}/?embedded=${embedded}`);
    await render(false, embedded);
    await page.locator(".pb-slot-button").waitFor();
    assert.equal(await input.inputValue(), "UTC", "a fresh URL defaults to device zone");
    assert.equal(reads.length, beforeFresh + 1, "fresh entry still issues exactly one initial availability read");
    assert.equal(reads.at(-1).searchParams.has("inviteeTimezone"), false, "fresh entry never submits the device zone");
    await render(true, embedded, true);
    const beforePreview = reads.length;
    await render(false, embedded, true);
    await page.getByText("Operator preview — providers are not used from preview.", { exact: true }).waitFor();
    assert.equal(reads.length, beforePreview, "operator preview must not read availability");
  }
  assert.deepEqual(errors, []);
});
