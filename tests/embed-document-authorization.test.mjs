import assert from "node:assert/strict";
import { before, after } from "node:test";
import { contract } from "./contract.mjs";
import { stripComments } from "./html-text.mjs";
import { call, data, origin, read, start, stop } from "./embed-document-authorization/runtime.mjs";

const parent = "https://allowed.example.test";
const eventPath = "/embed/dial-host/intro";
let selection, receipt, token, week;
const withParent = (path, value = parent) => `${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ parent: value })}`;
const detailsPath = () => `${eventPath}/details?${new URLSearchParams({ nonce: selection.nonce, startAt: selection.selection.startAt, inviteeTimezone: "UTC" })}`;
const confirmedPath = () => `${eventPath}/confirmed?${new URLSearchParams({ token })}`;
const managePath = () => `/embed/manage/${encodeURIComponent(token)}`;
const shapes = () => [eventPath, `${eventPath}/request`, detailsPath(), confirmedPath(), managePath()];
const state = value => call("/__fixtures/embed-state", value, 204);
const payload = result => result.payloadJson ? JSON.parse(result.payloadJson) : null;
async function blocked(path, label, ssr = false) {
  if (ssr) await blockedSurface(path, label);
  const result = await read(path);
  assert.equal(result.status, 404, `${label}: denied loader status`);
  assert.equal(result.payloadJson, null, `${label}: denied loader has no public data or capabilities`);
}
async function blockedSurface(path, label) {
  const response = await call(path, undefined, 404);
  assert.ok(response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), `${label}: framing denied`);
  assert.equal(response.headers.get("set-cookie"), null);
  const html = await response.text();
  for (const marker of ["Morgan Bell", "A focused introduction", "Thirty minutes to talk", "Document authorization invitee", "embed-invitee@dial.test", "manageUrl", "icsUrl"]) {
    assert.ok(!html.includes(marker), `${label}: denied SSR contains no projected content`);
  }
  assert.ok(html.includes("This booking step is unavailable."), `${label}: SSR renders neutral recovery`);
  assert.ok(!html.includes('aria-label="Booking progress"'), `${label}: denied SSR has no booking controls`);
}
async function allowed(path, expectedText) {
  const result = await read(withParent(path));
  assert.equal(result.status, 200, "authorized loader remains available");
  assert.ok(result.payloadJson, "authorized loader carries its public projection");
  const response = await call(withParent(path));
  assert.ok(response.headers.get("content-security-policy")?.includes(`frame-ancestors ${parent}`), "authorized document frames only its allowed parent");
  assert.equal(response.headers.get("set-cookie"), null);
  const html = await response.text();
  assert.ok(stripComments(html).includes(expectedText), "authorized SSR retains its actual booking content");
  return payload(result);
}

before(async () => {
  await start();
  await data("/__fixtures/setup", {});
  await state({ allowedOrigins: [parent] });
  const event = await data("/api/public/events/dial-host/intro");
  week = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const availability = await data(`/api/public/book/dial-host/intro/availability?week=${week}&inviteeTimezone=UTC`);
  const slots = availability.slots.filter(slot => Date.parse(slot.startAt) > Date.now() + 86400000);
  assert.ok(slots.length >= 8, "native fixture has future bookable times");
  selection = await data("/api/public/book/dial-host/intro/selection", { startAt: slots[0].startAt, inviteeTimezone: "UTC" }, 201);
  const selected = await data("/api/public/book/dial-host/intro/selection", { startAt: slots[4].startAt, inviteeTimezone: "UTC" }, 201);
  receipt = await data("/api/public/book/dial-host/intro/confirm", { nonce: selected.nonce, startAt: selected.selection.startAt, inviteeTimezone: "UTC", name: "Document authorization invitee", email: "embed-invitee@dial.test", answers: { [event.eventType.questions[0].key]: "Synthetic booking answer" } }, 201);
  token = new URL(receipt.manageUrl).pathname.split("/").at(-1);
});
after(stop);

contract("BASE-PUBLIC-002", "denied parent has neither SSR booking content nor loader payload for every embed step", async () => {
  for (const [index, path] of shapes().entries()) await blocked(withParent(path, "https://denied.example.test"), `shape ${index}`, true);
});

contract("BASE-PUBLIC-002", "missing, malformed and ambiguous embed parents fail closed before public document projection", async () => {
  for (const [index, path] of shapes().entries()) {
    await blocked(path, `missing parent shape ${index}`);
    for (const invalid of ["", "null", "https://allowed.example.test/", "https://allowed.example.test/path", "http://allowed.example.test", "https://allowed.example.test@denied.example.test"]) {
      await blocked(withParent(path, invalid), `invalid parent shape ${index}`);
    }
    await blocked(withParent(withParent(path), "https://denied.example.test"), `duplicate parent shape ${index}`);
  }
});

contract("PUBLIC-005", "unsupported embed paths cannot project a profile, event or manage capability", async () => {
  for (const [index, path] of ["/embed", "/embed/dial-host", "/embed/manage", `${eventPath}/other`, `${eventPath}/details/extra`, `${managePath()}/extra`, "/embed//dial-host/intro", `${eventPath}/`, "/embed/dial-host/intro//request"].entries()) {
    await blocked(withParent(path), `unsupported shape ${index}`);
  }
});

contract("PUBLIC-005", "unpublished and unknown event embeds return no receipt projection while valid standalone manage remains usable", async () => {
  for (const status of ["draft", "disabled"]) {
    await state({ status });
    try {
      for (const [index, path] of shapes().slice(0, 4).entries()) await blocked(withParent(path), `unpublished ${status} shape ${index}`, true);
      assert.equal((await read(`/manage/${encodeURIComponent(token)}`)).status, 200, "existing standalone manage survives unpublishing");
      await allowed(managePath(), "A focused introduction");
    } finally { await state({ status: "published" }); }
  }
  for (const path of ["/embed/missing-host/intro", "/embed/dial-host/missing-event", confirmedPath().replace("/intro/", "/missing-event/")]) await blocked(withParent(path), "unknown event", true);
});

contract("PUBLIC-004", "allowed event, details, confirmation, manage and request-only SSR preserve standalone projections", async () => {
  for (const path of shapes()) {
    await allowed(path, "A focused introduction");
    const standalone = path.startsWith("/embed/manage/") ? path.replace("/embed/manage/", "/manage/") : path.replace("/embed/", "/book/");
    const expected = await read(standalone), actual = await read(withParent(path));
    assert.ok(actual.payloadJson === expected.payloadJson, "embed and standalone expose the identical authorized public projection");
  }
  await state({ requestOnly: true });
  try {
    const request = await allowed(eventPath, "Request a time with Morgan Bell.");
    assert.equal(request.eventType.requestOnly, true);
    await allowed(`${eventPath}/request`, "Send another request.");
  } finally { await state({ requestOnly: false }); }
});

contract("PUBLIC-004", "authorized embed manage keeps native reschedule, token expiry and cancellation behavior", async () => {
  const previousToken = token;
  const availability = await data(`/api/public/manage/${encodeURIComponent(token)}/reschedule/availability?week=${week}&inviteeTimezone=UTC`);
  const slot = availability.slots.find(candidate => candidate.startAt !== receipt.occurrence.startAt && Date.parse(candidate.startAt) > Date.now() + 86400000);
  assert.ok(slot, "native reschedule engine returns a replacement time");
  const selected = await data(`/api/public/manage/${encodeURIComponent(token)}/reschedule/selection`, { startAt: slot.startAt, inviteeTimezone: "UTC" }, 201);
  const current = await allowed(managePath(), "Currently:");
  assert.equal(current.occurrence.startAt, receipt.occurrence.startAt, "old slot remains until commit");
  receipt = await data(`/api/public/manage/${encodeURIComponent(token)}/reschedule`, { nonce: selected.nonce, startAt: slot.startAt, inviteeTimezone: "UTC" });
  token = new URL(receipt.manageUrl).pathname.split("/").at(-1);
  assert.equal((await allowed(managePath(), "Currently:")).occurrence.startAt, slot.startAt);
  const rotated = await data("/__fixtures/embed-rotate", {});
  assert.equal(rotated.kind, "rotated", "production capability rotation invalidates the prior link");
  token = new URL(rotated.manageUrl).pathname.split("/").at(-1);
  const expiredPath = `/embed/manage/${encodeURIComponent(previousToken)}`;
  const expired = await read(withParent(expiredPath));
  assert.equal(expired.status, 410); assert.equal(expired.payloadJson, null);
  await call(withParent(expiredPath), undefined, 410);
  await blocked(withParent(expiredPath, "https://denied.example.test"), "denied expired capability", true);
  await data(`/api/public/manage/${encodeURIComponent(token)}/cancel`, {});
  assert.equal((await allowed(managePath(), "This booking has been cancelled.")).state, "cancelled");
  assert.equal((await allowed(confirmedPath(), "This booking is cancelled.")).state, "cancelled");
  assert.ok(new URL(receipt.manageUrl).origin === origin, "native capability belongs to the isolated install");
});
