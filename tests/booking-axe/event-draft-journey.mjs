import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { button, field, get, mutation } from "./keyboard-controls.mjs";

/** Extend the keyboard journey: incomplete details stay local while valid edits still save. */
export async function eventDraftJourney(page, origin, eventId, keys, checks, width) {
  const path = `/api/app/event-types/${eventId}/details`;
  const writes = [];
  const observe = response => {
    if (new URL(response.url()).pathname === path && response.request().method() === "PATCH") writes.push({ status: response.status(), value: response.request().postDataJSON() });
  };
  page.on("response", observe);
  try {
    const before = await get(page, origin, `/api/app/event-types/${eventId}`);
    await keys.select(field(page, "Location kind"), "phone", "Stage another place kind");
    assert.equal(await field(page, "Private link, number, or address").inputValue(), "");
    await delay(850);
    assert.equal(writes.length, 0, "switching to a place that still needs its value sends nothing");
    const description = `Description beside an unfinished place ${width}`;
    await mutation(page, path, async () => { await keys.type(field(page, "Description"), description, "Save a description beside an unfinished place"); await page.keyboard.press("Tab"); });
    assert.equal(writes.length, 1, "the unrelated edit saves once");
    assert.equal(writes[0].status, 200);
    let saved = await get(page, origin, `/api/app/event-types/${eventId}`);
    assert.equal(saved.description, description);
    assert.deepEqual(saved.locations, before.locations, "an unfinished switched place keeps the server's saved place");
    await keys.activate(page.getByRole("link", { name: "‹ Event types", exact: true }), "Try leaving an unfinished place");
    await page.waitForFunction(() => globalThis.document.activeElement?.matches("[data-autosave-attention]"));
    assert.equal(new URL(page.url()).pathname, `/app/event-types/${eventId}`, "an incomplete place holds navigation");
    assert.equal(writes.length, 1, "leaving an incomplete place sends no refused write");
    await mutation(page, path, async () => { await keys.type(field(page, "Private link, number, or address"), "+14155550100", "Complete the staged phone number"); await page.keyboard.press("Tab"); });
    assert.equal(writes.length, 2, "completing a staged place writes once");
    await page.reload(); await field(page, "Name").waitFor();
    assert.equal(await field(page, "Private link, number, or address").inputValue(), "+14155550100");
    saved = await get(page, origin, `/api/app/event-types/${eventId}`);
    assert.equal(saved.locations[0].type, "phone"); assert.equal(saved.locations[0].value, "+14155550100");

    const placeCount = saved.locations.length;
    await keys.activate(button(page, "Add another place"), "Stage an extra place");
    await delay(850);
    assert.equal(writes.length, 2, "an empty added place sends nothing");
    const nextDescription = `${description}, with an added place`;
    await mutation(page, path, async () => { await keys.type(field(page, "Description"), nextDescription, "Save beside an empty extra place"); await page.keyboard.press("Tab"); });
    saved = await get(page, origin, `/api/app/event-types/${eventId}`);
    assert.equal(saved.description, nextDescription); assert.equal(saved.locations.length, placeCount, "new incomplete places are excluded from unrelated saves");
    await keys.activate(button(page, "Remove place").last(), "Remove the incomplete extra place");
    await delay(850);
    assert.equal(writes.length, 3, "removing an unsaved place needs no write");

    await keys.activate(page.getByRole("link", { name: /^Advanced settings/ }), "Open settings for staged questions");
    await page.getByRole("dialog", { name: "Advanced settings", exact: true }).waitFor();
    const questionsRow = page.getByRole("button", { name: /^Questions/ });
    await keys.activate(questionsRow, "Open questions for staging");
    const summaryBefore = await questionsRow.innerText();
    const questionCount = saved.questions.length;
    await keys.activate(button(page, "Add question"), "Stage an extra question");
    await delay(850);
    assert.equal(writes.length, 3, "an empty added question sends nothing");
    assert.equal(await questionsRow.innerText(), summaryBefore, "the question summary counts only saved questions");
    await keys.activate(button(page, "Close settings"), "Try closing with an incomplete question");
    await page.waitForFunction(() => globalThis.document.activeElement?.matches("[data-autosave-attention]"));
    assert.equal(new URL(page.url()).pathname, `/app/event-types/${eventId}/advanced`, "an incomplete question holds sheet close");
    assert.equal((await get(page, origin, `/api/app/event-types/${eventId}`)).questions.length, questionCount);
    const label = `New keyboard question ${width}`;
    await mutation(page, path, async () => { await keys.type(field(page, `Question ${questionCount + 1} label`), label, "Complete the staged question"); await page.keyboard.press("Tab"); });
    assert.equal(writes.length, 4, "completing a staged question writes once");
    await page.reload();
    await keys.activate(page.getByRole("button", { name: /^Questions/ }), "Read the completed question");
    assert.equal(await field(page, `Question ${questionCount + 1} label`).inputValue(), label);
    assert.equal((await get(page, origin, `/api/app/event-types/${eventId}`)).questions.at(-1).label, label);
    await mutation(page, path, () => keys.activate(button(page, "Remove question").last(), "Remove the extra saved question"));
    await keys.activate(button(page, "Close settings"), "Close completed question settings");
    await page.waitForURL(origin + `/app/event-types/${eventId}`);
    assert.ok(writes.every(write => write.status === 200), "none of the staged or completed edits produces a refused details write");
    checks.push({ width, check: "Incomplete place kind, extra place and question stay local; unrelated details save; navigation is held until complete or removed", writes, refused: writes.filter(write => write.status >= 400).length, passed: true });
  } finally { page.off("response", observe); }
}
