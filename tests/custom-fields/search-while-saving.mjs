import assert from "node:assert/strict";

// Leaving the page waits for a private field's save; staying on it never does. On Bookings, Search is a navigation within
// the page: a booking's value saving slowly, or refused, never holds up typing there, and a refused value is held and sent
// again when its booking is shown again. A save that lands while Search has its booking off screen is what the booking
// shows when it is back.
export async function searchWhileSaving(owner, origin, fixture) {
  const headers = { Origin: origin };
  const created = await owner.request.post(origin + "/api/app/custom-fields", { headers, data: { entity: "booking", label: "Follow-up", kind: "text", options: [] } });
  assert.equal(created.status(), 201);
  const field = await created.json();
  const event = await (await owner.request.get(`${origin}/api/app/event-types/${fixture.eventId}`)).json();
  const week = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const { slots } = await (await owner.request.get(`${origin}/api/public/book/dial-host/intro/availability?week=${week}`)).json();
  const book = async (name, slot) => {
    const response = await owner.request.post(origin + "/api/app/bookings", { headers, data: { eventTypeId: event.id, startAt: slot.startAt, inviteeTimezone: "UTC", name, email: `${name.split(" ")[0].toLowerCase()}@dial.test`, answers: Object.fromEntries(event.questions.map((question) => [question.key, "Next steps"])), overrideNoticeAndHorizon: false } });
    assert.equal(response.status(), 201);
    return response.json();
  };
  const aiko = await book("Aiko Tanaka", slots[0]);
  await book("Tom Becker", slots[1]);
  const stored = async () => (await (await owner.request.get(`${origin}/api/app/custom-fields/booking/${aiko.id}`)).json()).find((entry) => entry.id === field.id).value;
  const landed = async (value) => {
    for (let wait = 0; wait < 40 && (await stored()) !== value; wait++) await new Promise((done) => setTimeout(done, 250));
    return stored();
  };

  const page = await owner.newPage();
  await page.goto(`${origin}/app/bookings`);
  await page.locator('[data-operator-ready="true"]').waitFor();
  const main = page.getByRole("main");
  const search = main.getByRole("searchbox");
  const region = main.getByRole("region", { name: "Custom fields" });
  const note = region.getByRole("textbox", { name: field.label, exact: true });
  // Aiko's panel (her field loads after it); Search below shows Tom's booking in its place, and clearing it shows hers.
  const aikoShown = async () => { await main.getByRole("heading", { name: "Aiko Tanaka" }).waitFor(); await note.waitFor(); };
  await main.getByRole("button", { name: /Aiko Tanaka/ }).click();
  await aikoShown();
  // Search takes focus from the field, which starts its save; then an owner types a key every 80 ms. What the box holds
  // once it settles (2 s at most).
  const searchFor = async (text) => {
    await search.click();
    await page.waitForTimeout(150);
    for (const key of text) { await page.keyboard.press(key); await page.waitForTimeout(80); }
    for (let wait = 0; wait < 20 && (await search.inputValue()) !== text; wait++) await page.waitForTimeout(100);
    return search.inputValue();
  };

  await page.route("**/api/app/custom-fields/**", async (route) => {
    if (route.request().method() === "PUT") await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await note.pressSequentially("Send the plan", { delay: 15 });
  assert.equal(await searchFor("Tom"), "Tom", "a slow save never holds up Search");
  await page.waitForURL((url) => url.searchParams.get("query") === "Tom");
  assert.equal(await landed("Send the plan"), "Send the plan", "the slow save still lands");
  await page.unroute("**/api/app/custom-fields/**");

  await search.fill("");
  await aikoShown();
  await page.route("**/api/app/custom-fields/**", (route) => route.request().method() === "PUT" ? route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "field_not_found", message: "Record or custom field not found." } }) }) : route.continue());
  await note.press("ControlOrMeta+a");
  await note.pressSequentially("Send the plan by Friday", { delay: 15 });
  await region.getByRole("alert").waitFor();
  assert.equal(await searchFor("Tom"), "Tom", "a refused save never holds up Search");
  assert.equal(await search.evaluate((element) => element === element.ownerDocument.activeElement), true, "Search keeps focus while a save is refused");
  await page.waitForURL((url) => url.searchParams.get("query") === "Tom");
  // The server takes it again: shown again, the booking sends its held value with no Retry.
  await page.unroute("**/api/app/custom-fields/**");
  await search.fill("");
  await aikoShown();
  assert.equal(await note.inputValue(), "Send the plan by Friday", "the refused value was held");
  assert.equal(await landed("Send the plan by Friday"), "Send the plan by Friday", "the held value is sent again when its booking is shown again");

  // Search for the booking's own name while its note saves: the save lands while the list reload has its panel off screen,
  // and the panel comes back from a read the navigation took before that. It shows the typed note, and the next word saves
  // on top of it.
  await page.route("**/api/app/custom-fields/**", async (route) => {
    if (route.request().method() === "PUT") await new Promise((done) => setTimeout(done, 550));
    await route.continue();
  });
  await note.press("ControlOrMeta+a");
  await note.pressSequentially("Call Aiko back on Tuesday", { delay: 15 });
  assert.equal(await searchFor("Aiko"), "Aiko");
  await page.waitForURL((url) => url.searchParams.get("query") === "Aiko");
  assert.equal(await landed("Call Aiko back on Tuesday"), "Call Aiko back on Tuesday");
  await page.unroute("**/api/app/custom-fields/**");
  await aikoShown();
  assert.equal(await note.inputValue(), "Call Aiko back on Tuesday", "a save that lands off screen is shown when its booking is back");
  await note.click();
  await note.evaluate((element) => element.setSelectionRange(element.value.length, element.value.length));
  await note.pressSequentially(" and the agenda", { delay: 15 });
  assert.equal(await landed("Call Aiko back on Tuesday and the agenda"), "Call Aiko back on Tuesday and the agenda", "the next word saves on top of the typed note");
  await page.close();
}
