import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { contract } from "./contract.mjs";
import { render } from "./request-only-identity/render.mjs";

const css = await readFile(new URL("../src/core/features/public-booking/ui/public-booking.css", import.meta.url), "utf8");
const data = {
  profile: { name: "Alex Rivera", handle: "alex-rivera", title: "Independent advisor", timezone: "UTC", socialProof: [] },
  eventType: { title: "Planning the next chapter", slug: "next-chapter", description: "Discuss the next step.", durationMinutes: 25, locationLabel: "Phone", requestOnly: true },
};
for (const embedded of [false, true]) contract(embedded ? "PUBLIC-004" : "PUBLIC-001", `${embedded ? "embedded" : "standalone"} request-only page visibly identifies the real event and host across responsive widths`, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const width of [390, 760, 1050, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(await render(data, embedded));
      await page.addStyleTag({ content: css });
      await expect(page.getByRole("heading", { name: `Request a time with ${data.profile.name}.`, exact: true })).toBeVisible();
      await expect(page.getByText("Requests only", { exact: true })).toBeVisible();
      await expect(page.locator(".pb-event-flow").getByRole("heading", { name: data.eventType.title, exact: true })).toBeVisible();
      // This entry offers the request composer, with no automatic slot-booking path.
      // The booking-wire journey separately proves that submitting it creates no booking or occurrence.
      assert.equal(await page.locator(".pb-slot-button").count(), 0);
      assert.equal(await page.getByRole("link", { name: "View availability", exact: true }).count(), 0);
      const action = page.getByRole("link", { name: "Send another request", exact: true });
      await expect(action).toBeVisible();
      await expect(action).toHaveAttribute("href", `${embedded ? "/embed/" : "/book/"}${data.profile.handle}/${data.eventType.slug}/request${embedded ? "?parent=https%3A%2F%2Fhost.example.test#dial-parent=https%3A%2F%2Fhost.example.test" : ""}`);
    }
  } finally { await browser.close(); }
});
