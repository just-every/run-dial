import assert from "node:assert/strict";
import { after, before } from "node:test";
import { chromium } from "@playwright/test";
import { contract } from "./contract.mjs";
import { auditor, keyboardActivate } from "./booking-axe/audit.mjs";
import { call, data, origin, start, stop } from "./external-routing/runtime.mjs";
import { parentOrigin, startParent } from "./external-routing/parent-page.mjs";

const handoffPath = "/api/public/external-routing/handoff";
const bookingPath = /\/book\/dial-host\/route-consult(\?|$)/;
const widths = [1440, 390];
const fullMap = [
  { field: "full_name", prefill: "name" }, { field: "work_email", prefill: "email" },
  { field: "topic", question: "purpose" }, { field: "company", question: "company" },
  { field: "goal", prefill: "answer.q_goal" },
];
let browser, parent, formId, eventId, scans = [];
const state = () => data("/__fixtures/external-routing/state");
const inviteeEmail = ["synthetic-dial-1501", "example.test"].join("@");
let visitors = 0;
// Each browser context is its own client to Dial's per-address public admission, as separate visitors would be.
const client = () => ({ "CF-Connecting-IP": `198.19.${Math.floor(visitors / 250)}.${visitors++ % 250 + 1}` });
const tokenShape = /[A-Za-z0-9_-]{43}/;

before(async () => {
  await start();
  await data("/__fixtures/setup", {});
  ({ formId, eventId } = await data("/__fixtures/external-routing/seed", {}));
  parent = await startParent(origin);
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await parent?.close(); await stop(); });

/** A visitor on the website (a different origin from Dial) with the form filled in. */
async function visitor(width, { map = fullMap, mounts = 2, routing = formId, topic = "consult", goal = "Launch plan", tag = "site", fill = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, extraHTTPHeaders: client() });
  const page = await context.newPage();
  await page.goto(`${parentOrigin}/form?${new URLSearchParams({ routing, map: JSON.stringify(map), mounts: String(mounts), tag })}`);
  if (fill) {
    await page.fill("[name=full_name]", "Alex Rivera");
    await page.fill("[name=work_email]", inviteeEmail);
    await page.selectOption("[name=topic]", topic);
    await page.fill("[name=company]", "Acme Studio");
    await page.fill("[name=goal]", goal);
  }
  return { context, page };
}
/** Submit with the keyboard, as a visitor would, and catch the one Dial window the script opens. */
async function submitWithEnter(page) {
  const opened = page.waitForEvent("popup");
  await page.focus("[name=work_email]");
  await page.keyboard.press("Enter");
  const popup = await opened;
  popup.on("pageerror", error => assert.fail(`handoff script error: ${error.message}`));
  return popup;
}
async function delta(action) {
  const before = await state();
  const result = await action();
  const after = await state();
  return { result, submissions: after.submissions.length - before.submissions.length, bookings: after.bookings - before.bookings, outbox: after.delivery_outbox - before.delivery_outbox, after };
}
async function settle(popup) {
  await popup.waitForURL(bookingPath, { timeout: 30000 }).catch(async error => { throw new Error(`${error.message}\nstuck at ${popup.url()}: ${await popup.locator("body").innerText()}`); });
  await popup.getByRole("button").first().waitFor();
}

contract("ROUTE-004", "a plain HTML form hands its mapped answers to routing and the visitor lands on the native booking page with editable answers, one submission through every duplicate path", async () => {
  for (const width of widths) {
    const started = await state();
    // Duplicate script mounting, a double submit, the keyboard and the booking confirmation step.
    const first = await delta(async () => {
      const { page, context } = await visitor(width, { mounts: 2, tag: `first-${width}` });
      const popup = await submitWithEnter(page);
      await page.evaluate(() => { const form = globalThis.document.getElementById("contact"); form.requestSubmit(); form.requestSubmit(); });
      await settle(popup);
      assert.equal(context.pages().length, 2, "duplicate mounting and repeated submits reuse one Dial window");
      assert.equal(await popup.evaluate(() => globalThis.window.opener), null, "the Dial window cannot reach the website");
      assert.deepEqual((await page.evaluate(() => globalThis.window.dialEvents.map(event => event.type))).filter((type, index, all) => all.indexOf(type) === index), ["dial:routing-opened"]);
      await page.waitForFunction(() => globalThis.document.querySelectorAll("script[data-dial-mounted]").length === 2);
      assert.ok(parent.received.includes(`first-${width}`), "the website's own form submissions are never blocked or changed");
      const landed = new URL(popup.url());
      assert.equal(landed.origin, origin);
      assert.deepEqual([...landed.searchParams.keys()].sort(), ["answer.q_goal", "email", "name"], "only the mapped prefill reaches the booking page");
      assert.equal(landed.searchParams.get("name"), "Alex Rivera");
      assert.equal(landed.searchParams.get("answer.q_goal"), "Launch plan");
      assert.ok(!tokenShape.test(landed.href), "no capability appears in the booking URL");
      assert.ok(!/Acme|consult/.test(landed.search), "routing-only answers are not copied to the booking page");
      const stored = JSON.parse(await popup.evaluate(() => globalThis.sessionStorage.getItem("dial-external-routing:v1")));
      assert.deepEqual(Object.keys(stored).sort(), ["key", "stage", "target"], "the finished handoff keeps no capability and no routing-only answer");
      assert.equal(stored.stage, "done");
      assert.ok(!stored.target.includes("Acme"));
      return { popup, context };
    });
    assert.equal(first.submissions, 1, `${width}: exactly one routing submission`);
    assert.equal(first.after.submissions.at(-1).state, "matched");
    const { popup, context } = first.result;
    assert.equal(first.bookings + first.outbox, 0, "routing books and sends nothing");
    await popup.getByRole("heading", { level: 1 }).first().waitFor();
    const audit = auditor(popup, width, scans);
    await keyboardActivate(popup, popup.locator(".pb-slot-button").first());
    const name = popup.getByLabel("Name", { exact: true }), email = popup.getByLabel("Email", { exact: true }), goal = popup.getByLabel("Goal of the call", { exact: true });
    await name.waitFor();
    assert.equal(await name.inputValue(), "Alex Rivera");
    assert.equal(await email.inputValue(), inviteeEmail);
    assert.equal(await goal.inputValue(), "Launch plan");
    assert.equal(await popup.getByLabel("Team size", { exact: true }).inputValue(), "", "unmapped booking questions stay empty");
    await audit("prefilled-details");
    const idle = await state();
    assert.equal(idle.bookings, started.bookings, "nothing is booked before the visitor confirms");
    assert.equal(idle.delivery_outbox, started.delivery_outbox, "nothing is sent before the visitor confirms");
    if (width === 1440) {
      await name.fill("Alex R. Rivera");
      await goal.fill("Launch plan, edited");
      await keyboardActivate(popup, popup.getByRole("button", { name: "Confirm booking", exact: true }));
      await popup.getByRole("heading", { name: "Booking confirmed.", exact: true }).waitFor();
      const booked = await state();
      assert.deepEqual(booked.bookingRows.map(row => row.name), ["Alex R. Rivera"], "the visitor's edit, not the mapped suggestion, is what is booked");
      assert.equal(booked.submissions.length, first.after.submissions.length, "confirming creates no further routing submission");
    }
    await context.close();

    // The response is lost after the submission was recorded: the keyboard retry replays it.
    const lost = await delta(async () => {
      const { page, context: lostContext } = await visitor(width, { tag: `lost-${width}`, goal: "Replay plan" });
      let hits = 0;
      await lostContext.route("**/api/public/routing/*/submit", async route => { if (++hits === 1) { await route.fetch(); await route.abort("failed"); } else await route.continue(); });
      const lostPopup = await submitWithEnter(page);
      await lostPopup.getByRole("alert").waitFor();
      assert.match(await lostPopup.locator("body").innerText(), /Nothing was booked/);
      await keyboardActivate(lostPopup, lostPopup.getByRole("button", { name: "Try again", exact: true }));
      await settle(lostPopup);
      assert.equal(new URL(lostPopup.url()).searchParams.get("answer.q_goal"), "Replay plan");
      assert.equal(hits, 2);
      await lostContext.close();
    });
    assert.equal(lost.submissions, 1, `${width}: a lost response and its replay record one submission`);
    assert.equal(lost.bookings, 0);

    // The handoff is reloaded while its first request is still in flight.
    const reloaded = await delta(async () => {
      const { page, context: reloadContext } = await visitor(width, { tag: `reload-${width}`, goal: "Reload plan" });
      let hits = 0, release, seen;
      const gate = new Promise(done => { release = done; }), firstHit = new Promise(done => { seen = done; });
      await reloadContext.route("**/api/public/routing/*/submit", async route => {
        if (++hits > 1) return route.continue();
        const response = await route.fetch(); seen(); await gate;
        await route.fulfill({ response }).catch(() => {});
      });
      const reloadPopup = await submitWithEnter(page);
      await firstHit;
      await reloadPopup.reload();
      await settle(reloadPopup);
      release();
      assert.equal(new URL(reloadPopup.url()).searchParams.get("answer.q_goal"), "Reload plan");
      await reloadContext.close();
    });
    assert.equal(reloaded.submissions, 1, `${width}: reloading the handoff records one submission`);
  }
});

contract("ROUTE-004", "native disqualification, an invalid map, an unavailable target and nonce refusals change nothing and book nothing", async () => {
  for (const width of widths) {
    // The routing form's own rule disqualifies: its message shows, nothing opens, and a reload replays no second submission.
    const disqualified = await delta(async () => {
      const { page, context } = await visitor(width, { topic: "other", tag: `other-${width}` });
      const popup = await submitWithEnter(page);
      await popup.getByText("Thanks, the team will email you instead.").waitFor();
      assert.equal(new URL(popup.url()).pathname, handoffPath);
      assert.equal(new URL(popup.url()).hash, "");
      await auditor(popup, width, scans)("handoff-disqualified");
      await popup.reload();
      await popup.getByText("Thanks, the team will email you instead.").waitFor();
      await context.close();
    });
    assert.equal(disqualified.submissions, 1);
    assert.equal(disqualified.after.submissions.at(-1).state, "disqualified");
    assert.equal(disqualified.bookings + disqualified.outbox, 0);

    // A map naming a question the routing form does not have is refused before anything is submitted.
    const unmapped = await delta(async () => {
      const { page, context } = await visitor(width, { map: [{ field: "topic", question: "no_such_question" }] });
      const popup = await submitWithEnter(page);
      await popup.getByRole("alert").waitFor();
      assert.match(await popup.locator("body").innerText(), /not connected correctly/);
      await auditor(popup, width, scans)("handoff-invalid-map");
      
      await context.close();
    });
    assert.equal(unmapped.submissions + unmapped.bookings + unmapped.outbox, 0);

    // A required routing answer the website never supplied is named, and nothing is recorded.
    const incomplete = await delta(async () => {
      const { page, context } = await visitor(width, { map: [{ field: "company", question: "company" }] });
      const popup = await submitWithEnter(page);
      await popup.getByRole("alert").waitFor();
      assert.equal(await popup.getByRole("listitem").allInnerTexts().then(items => items.join()), "Purpose");
      await auditor(popup, width, scans)("handoff-required");
      await context.close();
    });
    assert.equal(incomplete.submissions + incomplete.bookings, 0);

    // The booking destination is unavailable: nothing is recorded, then the same capability succeeds once it returns.
    await call("/__fixtures/external-routing/event", { id: eventId, status: "disabled" }, 204);
    const unavailable = await delta(async () => {
      const { page, context } = await visitor(width, { tag: `unavailable-${width}` });
      const popup = await submitWithEnter(page);
      await popup.getByRole("alert").waitFor();
      assert.match(await popup.locator("body").innerText(), /scheduling page is not available/);
      await auditor(popup, width, scans)("handoff-unavailable");
      return { popup, context };
    });
    assert.equal(unavailable.submissions + unavailable.bookings, 0);
    await call("/__fixtures/external-routing/event", { id: eventId, status: "published" }, 204);
    const recovered = await delta(async () => {
      await keyboardActivate(unavailable.result.popup, unavailable.result.popup.getByRole("button", { name: "Try again", exact: true }));
      await settle(unavailable.result.popup);
      await unavailable.result.context.close();
    });
    assert.equal(recovered.submissions, 1, `${width}: the retry after recovery records one submission`);

    // An expired capability is refused and forgotten, so a fresh submit starts over.
    const expired = await delta(async () => {
      const { page, context } = await visitor(width, { tag: `expired-${width}` });
      await context.route("**/api/public/routing/*/submit", async route => { await call("/__fixtures/external-routing/expire", {}, 204); await route.continue(); });
      const popup = await submitWithEnter(page);
      await popup.getByRole("alert").waitFor();
      assert.match(await popup.locator("body").innerText(), /cannot be used/);
      assert.equal(await popup.evaluate(() => sessionStorage.length), 0);
      await context.close();
    });
    assert.equal(expired.submissions, 0);
  }

  // Maps and values the website script itself refuses: it never opens Dial, and the website's own form still submits.
  const refusedMaps = [
    ["a map that is not a list", "{", "invalid_map"],
    ["the same field twice", [fullMap[0], fullMap[0]], "invalid_map"],
    ["two fields for one question", [{ field: "topic", question: "purpose" }, { field: "company", question: "purpose" }], "invalid_map"],
    ["an unusable prefill target", [{ field: "goal", prefill: "answer.bad key" }], "invalid_map"],
    ["a password field", [{ field: "secret", question: "company" }], "invalid_map"],
    ["a field the form does not have", [{ field: "nowhere", question: "company" }], "invalid_map"],
    ["an unknown property", [{ field: "goal", question: "company", redirect: "https://evil.example.test/" }], "invalid_map"],
    ["a malformed routing form id", fullMap, "invalid_map", { routing: "not-a-form" }],
    ["a value over its bound", fullMap, "invalid_values", { goal: "x".repeat(4001), submit: true }],
  ];
  for (const [index, [name, map, code, options = {}]] of refusedMaps.entries()) {
    const tag = `refused-${index}`;
    const refused = await delta(async () => {
      const { page, context } = await visitor(390, { map, tag, mounts: 1, routing: options.routing ?? formId, goal: options.goal ?? "Launch plan" });
      await page.focus("[name=work_email]"); await page.keyboard.press("Enter");
      await page.waitForFunction(() => globalThis.window.dialEvents.length > 0);
      await page.waitForTimeout(500);
      assert.deepEqual(await page.evaluate(() => globalThis.window.dialEvents), [{ type: "dial:routing-refused", code }], name);
      assert.equal(context.pages().length, 1, `${name}: no Dial window opens`);
      await context.close();
    });
    assert.equal(refused.submissions + refused.bookings + refused.outbox, 0, name);
    assert.ok(parent.received.includes(tag), `${name}: the website's own form still submits`);
  }

  // The same refusals at the public doors the handoff reuses.
  const door = await data(`/api/public/routing/${formId}`);
  const answers = { purpose: "consult" };
  const submit = (nonce, body, status) => call(`/api/public/routing/${formId}/submit`, { nonce, answers: body ?? answers }, status);
  await submit("x".repeat(43), undefined, 404);
  await submit(door.capability.nonce, { purpose: "consult", stray: "x" }, 400);
  const before = (await state()).submissions.length;
  await submit(door.capability.nonce, undefined, 201);
  await submit(door.capability.nonce, undefined, 200);
  await submit(door.capability.nonce, { purpose: "other" }, 409);
  assert.equal((await state()).submissions.length, before + 1);
  const stale = await data(`/api/public/routing/${formId}`);
  await call("/__fixtures/external-routing/expire", {}, 204);
  await submit(stale.capability.nonce, undefined, 410);
  assert.equal((await state()).submissions.length, before + 1);
});

contract("ROUTE-004", "the handoff leaks no capability or answer and cannot be steered to another site", async () => {
  const encode = value => "v1." + Buffer.from(JSON.stringify(value)).toString("base64url");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: client() });
  const requests = [];
  context.on("request", request => { if (request.url().startsWith(origin)) requests.push({ url: request.url(), body: request.postData() ?? "" }); });
  const open = async fragment => {
    const page = await context.newPage();
    await page.goto(`${origin}${handoffPath}${fragment ? "#" + fragment : ""}`);
    return page;
  };

  // Extra payload fields that look like redirects are ignored; hostile values stay text.
  const steered = await delta(async () => {
    const page = await open(encode({ form: formId, answers: { purpose: "consult" }, prefill: { name: "Pat", "answer.q_goal": ["https://evil.example.test/steal"] }, redirect: "https://evil.example.test/", next: "//evil.example.test", bookingPath: "https://evil.example.test/book/x/y" }));
    await settle(page);
    const landed = new URL(page.url());
    assert.equal(landed.origin, origin);
    assert.equal(landed.pathname, "/book/dial-host/route-consult");
    assert.deepEqual([...landed.searchParams.keys()].sort(), ["answer.q_goal", "name"]);
    assert.equal(page.url().includes("#"), false);
  });
  assert.equal(steered.submissions, 1);
  const routingTraffic = requests.filter(request => request.url.includes("/api/public/routing/"));
  assert.ok(routingTraffic.every(request => !/Pat|evil|redirect/.test(request.url + request.body)), "prefill and extra fields never travel to the routing doors");
  assert.ok(requests.every(request => !request.url.includes("#")), "the fragment is never sent to a server");

  // Anything that is not a valid bounded payload is refused before any routing request.
  const seen = requests.length;
  for (const fragment of ["v1.@@@", "v2." + "A".repeat(20), "v1." + "A".repeat(70000), encode({ form: "not-an-id", answers: {}, prefill: {} }), encode({ form: formId, answers: { purpose: "x".repeat(2001) }, prefill: {} }), encode({ form: formId, answers: {}, prefill: { "bad key": ["x"] } }), encode({ form: formId, answers: [], prefill: {} })]) {
    const page = await open(fragment);
    await page.getByRole("alert").waitFor();
    assert.match(await page.locator("body").innerText(), /cannot be used/);
  }
  assert.ok(requests.slice(seen).every(request => !request.url.includes("/api/public/routing/")), "refused payloads reach no routing door");

  // The document is private, unframeable, script-limited and carries no cookie.
  const response = await call(handoffPath);
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'.*frame-ancestors 'none'/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.ok(!(await response.text()).includes(formId));
  await context.close();
});
