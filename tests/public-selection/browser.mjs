import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

export const storageKey = "dial:booking-selection:host:conversation";
export const data = {
  profile: { handle: "host", name: "Test Host", title: "Advisor", biography: "Host biography", timezone: "UTC", focusAreas: [], socialProof: [] },
  eventType: { slug: "conversation", title: "Conversation", description: "Discuss a question.", color: "green", bookingHorizonDays: 90, durationMinutes: 30, locationLabel: "Video call", alternativeRequestsEnabled: false, questions: [] },
};
export const capability = { nonce: "test-only-booking-capability", startAt: "2026-10-07T10:00:00.000Z", inviteeTimezone: "America/New_York" };
export const selected = { nonce: capability.nonce, expiresAt: "2026-10-05T00:30:00.000Z", selection: { startAt: capability.startAt, endAt: "2026-10-07T10:30:00.000Z", inviteeTimezone: capability.inviteeTimezone, hostTimezone: "UTC" }, host: data.profile, event: data.eventType };
export const detailsPath = (value = capability) => `/book/host/conversation/details?${new URLSearchParams(value)}`;

const source = await build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import { createRoot } from "react-dom/client";
    import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
    import { ChooseTime } from "./src/core/features/public-booking/ui/choose-time";
    import { BookingDetailsPage } from "./src/core/features/public-booking/ui/booking-details-page";
    import { PublicRecoveryPage } from "./src/core/features/public-booking/ui/recovery-page";
    import { bookingDetailsSearch, detailsCapability } from "./src/core/app/booking-search";
    import { DocumentData } from "./src/core/app/document-data";
    function Screen() {
      const query = new URLSearchParams(location.search);
      const capability = detailsCapability(bookingDetailsSearch(Object.fromEntries(query)));
      return <DocumentData.Provider value={{status: 200, payload: null, renderInstant: "2026-10-05T00:00:00.000Z"}}>
        {location.pathname.endsWith("/details") ? capability ? <BookingDetailsPage handle="host" slug="conversation" capability={capability} /> : <PublicRecoveryPage kind="booking" /> : <ChooseTime data={${JSON.stringify(data)}} />}
      </DocumentData.Provider>;
    }
    const routeTree = createRootRoute({ component: Screen });
    const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/" + location.search] }) });
    await router.load();
    createRoot(document.getElementById("root")).render(<RouterProvider router={router} />);
  ` }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic",
});

export async function browserFixture(t) {
  const reads = [], lookups = [], errors = [];
  let lookupStatus = 200;
  const slots = [7, 8].map(day => ({ startAt: `2026-10-0${day}T10:00:00.000Z`, endAt: `2026-10-0${day}T10:30:00.000Z`, hostDate: `2026-10-0${day}`, hostOffset: "UTC+00:00" }));
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const json = (value, status = 200) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(value)); };
    if (url.pathname.endsWith("/availability")) {
      reads.push(url.searchParams);
      json({ state: "available", week: "2026-10-05", slots, recommendations: [], rankedSlots: slots.map(slot => ({ ...slot, reason: "Inside host working day" })) });
    } else if (url.pathname.endsWith("/selection") && request.method === "POST") {
      let body = ""; for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      json({ ...selected, selection: { ...selected.selection, ...input } });
    } else if (url.pathname.endsWith("/selection")) {
      lookups.push(url.searchParams);
      const matches = Object.entries(capability).every(([key, value]) => url.searchParams.get(key) === value);
      json(lookupStatus === 200 && matches ? selected : { error: { message: "This booking step is unavailable." } }, matches ? lookupStatus : 404);
    } else if (url.pathname === "/entry.js") {
      response.writeHead(200, { "content-type": "text/javascript" }); response.end(source.outputFiles[0].text);
    } else if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); }
    else {
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<!doctype html><html lang="en"><head><title>Selection persistence regression</title></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>');
    }
  });
  let browser;
  let teardownPromise;
  async function closeServer() {
    if (server.listening) await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
    assert.equal(server.listening, false, "fixture server is closed");
  }
  async function closeBrowser() {
    if (!browser) return;
    await browser.close();
    assert.equal(browser.isConnected(), false, "fixture browser is closed");
  }
  function close() {
    if (!teardownPromise) {
      teardownPromise = (async () => {
        const failures = [];
        if (browser) {
          try { await closeBrowser(); } catch (error) { failures.push(error); }
        }
        try { await closeServer(); } catch (error) { failures.push(error); }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, "fixture teardown failed");
      })();
    }
    return teardownPromise;
  }
  t.after(close);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ timezoneId: "America/New_York", locale: "de-DE" });
  page.on("pageerror", () => errors.push("page error"));
  page.on("console", message => { if (message.type() === "error" && !message.text().includes("status of 404") && !message.text().includes("status of 410")) errors.push("console error"); });
  return { page, origin, reads, lookups, errors, close, setStatus: value => { lookupStatus = value; } };
}
