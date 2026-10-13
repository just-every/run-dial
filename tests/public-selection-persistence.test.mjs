import assert from "node:assert/strict";
import { contract } from "./contract.mjs";
import { browserFixture, capability, detailsPath, selected, storageKey } from "./public-selection/browser.mjs";

const stored = page => page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? "null"), storageKey);
const hasCapability = value => value?.nonce === capability.nonce && value?.startAt === capability.startAt && value?.inviteeTimezone === capability.inviteeTimezone;
const readyDetails = page => page.getByRole("heading", { name: "Confirm this time.", exact: true }).waitFor();

contract("PUBLIC-003", "selected slot and nonce persist in session storage and URL across details reload and history", async t => {
  const h = await browserFixture(t), { page, origin } = h;
  await page.goto(`${origin}/book/host/conversation`);
  await page.locator(".pb-slot-button").first().waitFor();
  assert.ok(h.reads.every(query => !query.has("inviteeTimezone")), "initial device zone stays in the browser");
  await page.locator(".pb-slot-button").first().click();
  await readyDetails(page);
  const url = new URL(page.url());
  assert.ok(Object.entries(capability).every(([key, value]) => url.searchParams.get(key) === value), "URL retains the issued capability");
  const saved = await stored(page);
  assert.ok(hasCapability(saved), "session storage must also carry the issued selection and nonce");
  assert.deepEqual(Object.keys(saved).sort(), ["expiresAt", "inviteeTimezone", "nonce", "startAt"], "only selection capability and expiry are persisted");
  assert.ok(saved.expiresAt === selected.expiresAt);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Private invitee");
  assert.ok(!JSON.stringify(await stored(page)).includes("Private invitee"), "selection storage does not capture invitee details");
  const beforeReload = h.lookups.length;
  await page.reload(); await readyDetails(page);
  assert.ok(h.lookups.length > beforeReload, "reload validates the URL capability with the server");
  assert.ok(hasCapability(await stored(page)));
  await page.goBack(); await page.locator(".pb-slot-button").first().waitFor();
  await page.goForward(); await readyDetails(page);
  assert.ok(hasCapability(await stored(page)));
  assert.equal((await page.context().cookies()).length, 0);
  assert.deepEqual(h.errors, []);
});

contract("PUBLIC-003", "valid details URL replaces stale storage only after server lookup and missing URL never restores stored authority", async t => {
  const h = await browserFixture(t), { page, origin } = h;
  await page.goto(`${origin}/book/host/conversation`);
  await page.evaluate(key => sessionStorage.setItem(key, JSON.stringify({ nonce: "stale-test-capability", startAt: "wrong", inviteeTimezone: "UTC" })), storageKey);
  await page.goto(origin + detailsPath()); await readyDetails(page);
  assert.ok(hasCapability(await stored(page)), "server validated URL must replace stale session storage");
  const beforeMissing = h.lookups.length;
  await page.goto(`${origin}/book/host/conversation/details`);
  await page.getByRole("heading", { name: "This booking step is unavailable.", exact: true }).waitFor();
  assert.equal(h.lookups.length, beforeMissing, "missing URL must not borrow or submit the session capability");
  assert.equal(await page.getByRole("textbox", { name: "Name", exact: true }).count(), 0);
  const beforeEntry = h.reads.length;
  await page.goto(`${origin}/book/host/conversation`);
  await page.locator(".pb-slot-button").first().waitFor();
  assert.ok(h.reads.slice(beforeEntry).every(query => !query.has("inviteeTimezone")), "stored selection never authorizes automatic zone submission on fresh entry");
  assert.deepEqual(h.errors, []);
});

contract("PUBLIC-003", "expired or mismatched URL capability clears its stored selection and renders neutral recovery", async t => {
  for (const [status, refused] of [[410, capability], [200, { ...capability, nonce: "unknown-test-capability" }], [200, { ...capability, startAt: "2026-10-08T10:00:00.000Z" }]]) {
    const h = await browserFixture(t), { page, origin } = h;
    h.setStatus(200);
    await page.goto(origin + detailsPath()); await readyDetails(page);
    // This test's fixture models a previously saved selection, even on unfixed source.
    await page.evaluate(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: { ...refused, expiresAt: selected.expiresAt } });
    h.setStatus(status);
    await page.goto(origin + detailsPath(refused));
    await page.getByRole("heading", { name: "This booking step is unavailable.", exact: true }).waitFor();
    assert.ok(await stored(page) === null, "server refusal invalidates matching stored progress");
    assert.doesNotMatch(await page.locator("main").innerText(), /Test Host|Conversation|Private invitee/);
    assert.equal(await page.getByRole("link", { name: /Return to the home page/ }).count(), 1);
    await page.evaluate(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: { ...capability, nonce: "newer-test-capability" } });
    h.setStatus(410);
    await page.goto(origin + detailsPath());
    await page.getByRole("heading", { name: "This booking step is unavailable.", exact: true }).waitFor();
    assert.ok((await stored(page))?.nonce === "newer-test-capability", "refusing an older capability must not erase newer progress");
    assert.equal((await page.context().cookies()).length, 0);
    assert.deepEqual(h.errors, []);
    await h.close();
  }
});

contract("AVAIL-005", "day and explicitly chosen zone survive history and reload without submitting device zone on entry", async t => {
  const h = await browserFixture(t), { page, origin } = h;
  await page.goto(`${origin}/book/host/conversation`);
  await page.locator(".pb-slot-button").first().waitFor();
  assert.ok(h.reads.every(query => !query.has("inviteeTimezone")));
  const zone = page.getByRole("combobox", { name: "View in timezone" });
  await zone.fill("Australia/Brisbane"); await zone.blur();
  await page.getByText("Checking current times…", { exact: true }).waitFor({ state: "hidden" });
  await page.locator('[data-date="2026-10-08"]').click();
  await page.reload(); await page.locator('[data-date="2026-10-08"][aria-pressed="true"]').waitFor();
  assert.equal(await zone.inputValue(), "Australia/Brisbane");
  await page.goBack(); await page.locator('[data-date="2026-10-07"][aria-pressed="true"]').waitFor();
  await page.goForward(); await page.locator('[data-date="2026-10-08"][aria-pressed="true"]').waitFor();
  assert.equal(await zone.inputValue(), "Australia/Brisbane");
  assert.deepEqual(h.errors, []);
});
