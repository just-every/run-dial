import assert from "node:assert/strict";
import { build } from "esbuild";
import { contract } from "./contract.mjs";
const bundle = await build({ stdin: { contents: 'import React from "react"; import { renderToStaticMarkup } from "react-dom/server"; import { nextTenDates, RequestDates } from "./src/core/features/public-booking/ui/request-dates"; import { dateInZone } from "./src/core/features/public-booking/ui/day-picker-model"; import { Question } from "./src/core/features/public-booking/ui/public-question"; import { DocumentData, useDocumentInstant } from "./src/core/app/document-data"; export { nextTenDates, dateInZone }; export const renderQuestion = props => renderToStaticMarkup(React.createElement(Question, props)); function SnapshotDates() { return React.createElement(RequestDates, {dates: nextTenDates(useDocumentInstant()), selected: [], onToggle() {}}); } export const renderDates = instant => renderToStaticMarkup(React.createElement(DocumentData.Provider, {value: {status: 200, payload: null, renderInstant: instant}}, React.createElement(SnapshotDates)));', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "esm", platform: "node", banner: { js: `import {createRequire} from "node:module"; const require = createRequire(${JSON.stringify(process.cwd() + "/package.json")});` } });
const { renderDates, renderQuestion, nextTenDates, dateInZone } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
contract("PUBLIC-003", "serialized document instant keeps request day markup identical across UTC and host midnight", () => {
  const NativeDate = Date;
  for (const instant of ["2026-10-08T23:59:59.999Z", "2026-10-08T13:59:59.999Z"]) {
    const expected = renderDates(instant);
    try {
      globalThis.Date = class extends NativeDate { constructor(value) { super(value ?? "2026-10-09T00:00:01.000Z"); } };
      assert.equal(renderDates(instant), expected);
      assert.equal(nextTenDates(instant)[0].value, "2026-10-09");
      assert.equal(dateInZone(instant, "Australia/Brisbane"), instant.includes("23:") ? "2026-10-09" : "2026-10-08");
    } finally { globalThis.Date = NativeDate; }
  }
});

contract("EVENT-003", "required choice groups and invalid question fields have visible requirements and described errors", () => {
  for (const kind of ["text", "textarea", "single_choice", "multiple_choice", "checkbox"]) {
    const markup = renderQuestion({question: {key: "goals", label: "Goals", kind, required: true, options: [{value: "focus", label: "Focus"}]}, value: kind === "multiple_choice" || kind === "checkbox" ? [] : "", error: "Choose your goals.", onChange() {}});
    assert.match(markup, /aria-invalid="true"/);
    const described = markup.match(/aria-describedby="([^"]+)"/)[1];
    assert.ok(markup.includes(`id="${described}"`)); assert.match(markup, /Choose your goals\./);
    if (kind === "multiple_choice" || kind === "checkbox") { assert.match(markup, /Goals<span> \(required\)<\/span>/); assert.doesNotMatch(markup, /type="checkbox"[^>]*required=/); }
    else { assert.match(markup, /required=""/); assert.match(markup, /aria-label="Goals"/); }
  }
});
