import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { contract } from "./contract.mjs";
import { brandedMailSamples } from "./branded-mail-samples.mjs";

function luminance(rgb) {
  const channels = rgb.match(/[0-9]+/gu).slice(0, 3).map((channel) => Number(channel) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

contract("NOTIFY-001", "all branded booking and request mail layouts fit 390 and 600 pixel viewports without loading resources", async (context) => {
  const { samples } = await brandedMailSamples();
  const browser = await chromium.launch({ headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const resourceRequests = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url !== "about:blank" && !url.startsWith("data:")) resourceRequests.push(url);
  });
  for (const { kind, html } of samples) {
    for (const width of [390, 600]) {
      await page.setViewportSize({ width, height: 844 });
      await page.setContent(html, { waitUntil: "load" });
      const result = await page.evaluate(() => {
        const currentDocument = globalThis.document;
        const button = currentDocument.querySelector("a");
        const buttonCell = button?.parentElement;
        return {
          viewport: globalThis.window.innerWidth,
          documentWidth: currentDocument.documentElement.scrollWidth,
          bodyWidth: currentDocument.body.scrollWidth,
          tables: currentDocument.querySelectorAll("table").length,
          externalElements: currentDocument.querySelectorAll("img,script,iframe,link[rel='stylesheet'],style").length,
          eventAttributes: [...currentDocument.querySelectorAll("*")].flatMap((element) => [...element.attributes])
            .filter((attribute) => /^on[a-z]+$/i.test(attribute.name)).length,
          resourceAttributes: [...currentDocument.querySelectorAll("*")].flatMap((element) => [...element.attributes])
            .filter((attribute) => ["src", "srcset", "background", "poster"].includes(attribute.name)).length,
          buttonColor: button ? globalThis.getComputedStyle(button).color : null,
          buttonBackground: buttonCell ? globalThis.getComputedStyle(buttonCell).backgroundColor : null,
        };
      });
      assert.equal(result.documentWidth, width, `${kind} document width at ${width}px`);
      assert.ok(result.bodyWidth <= width, `${kind} body overflows at ${width}px`);
      assert.ok(result.tables > 0, `${kind} uses tables`);
      assert.equal(result.externalElements, 0, `${kind} contains no external resource element`);
      assert.equal(result.eventAttributes, 0, `${kind} contains no event-handler attributes`);
      assert.equal(result.resourceAttributes, 0, `${kind} contains no resource URL attribute`);
      if (result.buttonColor && result.buttonBackground) assert.ok(contrast(result.buttonColor, result.buttonBackground) >= 4.5, `${kind} button contrast at ${width}px`);
    }
  }
  assert.deepEqual(resourceRequests, [], "mail HTML made no network requests");
});
