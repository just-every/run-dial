import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { evidencePath } from "../../scripts/evidence-path.mjs";
import { mkdir } from "node:fs/promises";

export async function followUpScreens({ page, owner, origin, eventId, locationId, width, index }) {
  const folder = evidencePath("follow-up-screens"); await mkdir(folder, { recursive: true }); const headers = { Origin: origin }, shots = [];
  const json = async (response, expected = 200) => { assert.equal(response.status(), expected, await response.text()); return response.status() === 204 ? null : response.json(); };
  const post = (path, data, status) => owner.request.post(origin + path, { headers, data }).then(response => json(response, status));
  await page.goto(`${origin}/app/event-types/${eventId}`); await expect(page.locator("[data-operator-ready=true]")).toBeVisible();
  const form = page.getByRole("form", { name: "Post-meeting follow-up", exact: true }); await expect(form.getByLabel("Send a post-meeting follow-up")).toBeEnabled();
  await form.getByLabel("Send a post-meeting follow-up").check(); await form.getByRole("textbox", { name: "Follow-up message", exact: true }).fill("Synthetic resource 1720 for {invitee first name}."); await form.getByRole("spinbutton", { name: "Minutes after the meeting ends", exact: true }).fill("5"); await form.getByLabel("Only when marked attended").check(); await form.getByRole("button", { name: "Save follow-up settings" }).click(); await form.getByRole("status").getByText("Follow-up settings saved.", { exact: true }).waitFor(); await capture("follow-up-setting", form);
  const starts = new Date(Date.now() + (10 + index) * 86400000); starts.setUTCHours(11, 0, 0, 0); const name = `Synthetic Dial ${1721 + index}`;
  const booking = await post("/api/app/bookings", { idempotencyKey: randomUUID(), eventTypeId: eventId, locationId, startAt: starts.toISOString(), inviteeTimezone: "UTC", name, email: `synthetic-dial-${1721 + index}@example.test`, answers: {}, overrideNoticeAndHorizon: false }, 201);
  await post("/__fixtures/follow-ups/end", { bookingId: booking.id }, 204); const facts = await json(await owner.request.get(origin + "/__fixtures/follow-ups/facts")), run = facts.runs.find(run => run.bookingId === booking.id); assert.ok(run);
  await post("/__fixtures/follow-ups/tick", { now: run.dueAt });
  await page.goto(origin + "/app/bookings?time=past"); await expect(page.locator("[data-operator-ready=true]")).toBeVisible(); await page.getByRole("button").filter({ hasText: name }).first().click();
  const history = page.getByRole("region", { name: "Post-meeting email history" }); await expect(history.getByText("skipped", { exact: true })).toBeVisible(); await expect(history.getByText("Reason: attendance required", { exact: true })).toBeVisible(); await capture("follow-up-wait", history);
  await post(`/api/app/bookings/${booking.id}/attendance`, { status: "attended", note: "" }); const after = new Date(Date.parse(run.dueAt) + 60000).toISOString(); await post("/__fixtures/follow-ups/tick", { now: after }); await post("/__fixtures/follow-ups/deliver", { now: after }); await history.getByRole("button", { name: "Refresh follow-up history" }).click(); await expect(history.getByText("sent", { exact: true })).toBeVisible(); await capture("follow-up-sent", history);
  await post(`/api/app/bookings/${booking.id}/cancel`, {}); await post("/__fixtures/follow-ups/deliver", { now: after });
  return { shots, width, tooltipAudit: "Follow-up form and record controls are visibly labeled; no icon-only controls." };
  async function capture(name, target) {
    await target.scrollIntoViewIfNeeded(); await page.evaluate(() => globalThis.document.fonts.ready); const axe = await new AxeBuilder({ page }).analyze(); assert.deepEqual(axe.violations.filter(item => ["serious", "critical"].includes(item.impact)).map(item => item.id), []); assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth + 1));
    const shot = `${name}-${width}.png`; await page.evaluate(() => globalThis.window.scrollTo(0, 0)); await page.screenshot({ path: `${folder}/${shot}`, fullPage: true }); shots.push(shot);
  }
}
