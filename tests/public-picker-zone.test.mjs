import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { build } from "esbuild";
import { contract } from "./contract.mjs";

const bundled = await build({ stdin: { contents: 'export * from "./src/core/shared/scheduling"; export * from "./src/core/features/public-booking/ui/day-picker-model"; export * from "./src/core/features/public-booking/ui/timezone-search"; export * from "./src/core/features/public-booking/ui/request-order";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "node" });
const scheduling = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
function compile(file) { return ts.transpileModule(readFileSync(`src/core/features/public-booking/ui/${file}`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText; }
function picker() {
  const states = new Map(); let owner, cursor = 0;
  const react = {
    useState(initial) { const cells = states.get(owner); const index = cursor++; if (!(index in cells)) cells[index] = typeof initial === "function" ? initial() : initial; return [cells[index], value => { cells[index] = typeof value === "function" ? value(cells[index]) : value; }]; },
    useRef(value) { return { current: value }; }, useMemo(fn) { return fn(); }, useCallback(fn) { return fn; }, useEffect() {}, useId() { return "zone"; },
  };
  const element = (type, props) => ({ type, props });
  const modules = {};
  function load(file) {
    const exports = {};
    vm.runInNewContext(compile(file), { exports, URL, Node: class {}, window: { location: { href: "https://dial.test/book/host/event" }, history: { pushState() {} } }, require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element };
      if (name === "@tanstack/react-router") return { useRouterState: () => "" };
      if (name.endsWith("/scheduling") || name.endsWith("/day-picker-model") || name.endsWith("/timezone-search") || name.endsWith("/request-order")) return scheduling;
      if (name.endsWith("/document-data")) return { useDocumentInstant: () => "2026-10-05T00:00:00.000Z" };
      if (name.endsWith("/flow-shell")) return { FlowShell: "shell" };
      return modules[name.slice(2)] ?? {};
    } });
    modules[file.replace(/\.tsx$/, "")] = exports;
    return exports;
  }
  load("timezone-control.tsx"); load("day-time-picker.tsx");
  const { ChooseTime } = load("choose-time.tsx");
  function renderComponent(type, props) { owner = type; cursor = 0; if (!states.has(type)) states.set(type, []); return type(props); }
  function nodes(value) { if (Array.isArray(value)) return value.flatMap(nodes); if (!value?.props) return []; if (typeof value.type === "function") return nodes(renderComponent(value.type, value.props)); return [value, ...nodes(value.props.children)]; }
  const data = { profile: { timezone: "UTC", handle: "host" }, eventType: { slug: "event", bookingHorizonDays: 90 } };
  function render() { return nodes(renderComponent(ChooseTime, { data })); }
  render();
  const slots = ["2026-10-05T10:00:00Z", "2026-10-05T11:00:00Z"].map(startAt => ({ startAt, endAt: startAt.replace(":00:00Z", ":30:00Z"), hostDate: "2026-10-05", hostOffset: "UTC+00:00" }));
  const cells = states.get(ChooseTime);
  cells[0] = { state: "available", week: "2026-10-05", slots, recommendations: [], rankedSlots: slots.map(slot => ({ ...slot, reason: "Native reason" })) };
  return { cells, render, get zone() { return cells[4] ?? cells[6]; }, slots: () => render().filter(node => node.props["data-start-at"]).map(node => node.props["data-start-at"]) };
}
contract("AVAIL-005", "invalid picker zone preserves active zone and availability rather than crashing formatters", () => {
  const h = picker();
  const original = h.slots();
  const availability = h.cells[0];
  assert.equal(original.length, 2);
  for (const value of ["Mars/Olympus", "", "UTC+10", "America/Invalid"]) {
    let input = h.render().find(n => n.type === "input"); input.props.onChange({ target: { value } });
    input = h.render().find(n => n.type === "input"); input.props.onBlur({ currentTarget: { parentElement: undefined }, relatedTarget: null });
    assert.equal(h.zone, "UTC");
    assert.match(h.render().find(node => node.props.role === "alert").props.children, /canonical IANA timezone/);
    assert.equal(h.cells[0], availability, "parent retains its actual availability response");
    assert.deepEqual(h.slots(), original, "rendered shared picker retains the original slots");
  }
  h.render().find(n => n.type === "input").props.onChange({ target: { value: " Australia/Brisbane " } });
  h.render().find(n => n.type === "input").props.onBlur({ currentTarget: { parentElement: undefined }, relatedTarget: null });
  assert.equal(h.zone, "Australia/Brisbane");
});
contract("AVAIL-005", "invitee day boundaries use the selected zone, including DST and non-hour offsets", () => {
  assert.equal(scheduling.hostDateToday("Pacific/Kiritimati", new Date("2026-10-02T10:15:00Z")), "2026-10-03");
  assert.equal(scheduling.hostDateToday("America/Los_Angeles", new Date("2026-10-02T00:15:00Z")), "2026-10-01");
  assert.equal(scheduling.hostDateToday("Asia/Kathmandu", new Date("2026-10-02T18:30:00Z")), "2026-10-03");
  for (const instant of ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"]) assert.equal(scheduling.hostDateToday("America/New_York", new Date(instant)), "2026-11-01");
  assert.equal(scheduling.isCanonicalIanaTimeZone("Mars/Olympus"), false);
});
