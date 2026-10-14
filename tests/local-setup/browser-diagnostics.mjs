import assert, { AssertionError } from "node:assert/strict";
import { createRequire } from "node:module";

// Resolve the same axe-core that the installed browser adapter injects. Only
// rule identifiers from that trusted package may enter public diagnostics.
const require = createRequire(import.meta.url);
const axe = createRequire(require.resolve("@axe-core/playwright"))("axe-core");
const ruleIds = new Set(axe.getRules().map(rule => rule.ruleId).filter(id => typeof id === "string" && /^[a-z][a-z0-9-]*$/.test(id)));
const impacts = new Set(["serious", "critical"]);
const checks = new Set([
  "navigation", "accessibility", "horizontal_overflow",
  "hosted_profile_write", "hosted_mail_check", "hosted_event_create", "hosted_event_publish",
  "hosted_link_copy", "hosted_setup_complete", "hosted_public_availability", "hosted_public_selection",
  "hosted_public_confirm", "hosted_booking_count", "hosted_booking_detail", "hosted_calendar_state",
  "hosted_answer_preserved", "hosted_management_url",
]);
const httpChecks = new Set([
  "hosted_profile_write", "hosted_mail_check", "hosted_event_create", "hosted_event_publish",
  "hosted_link_copy", "hosted_setup_complete", "hosted_public_selection", "hosted_public_confirm",
]);
const resourceTypes = new Set(["document", "stylesheet", "image", "media", "font", "script", "texttrack", "xhr", "fetch", "eventsource", "websocket", "manifest", "other"]);
const failures = new WeakMap();

function failureKind(error) {
  if (error instanceof AssertionError) return "assertion";
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  return "unclassified";
}

// Paths identify only these closed categories; no path or capability is emitted.
function responseRouteCategory(path) {
  if (typeof path !== "string") return "other";
  if (path.startsWith("/assets/")) return "assets";
  if (path.startsWith("/_serverFn/")) return "server_function";
  if (["/api/auth/sign-out", "/auth/signout"].includes(path)) return "auth_signout";
  if (["/api/auth/magic-links", "/auth/magic-link"].includes(path)) return "auth_magic_link";
  if (path === "/auth/confirm") return "auth_confirm";
  if (path === "/signin") return "signin";
  if (path === "/health") return "health";
  if (path.startsWith("/api/app/")) return "app_api";
  return "other";
}

/** Record the operation without forwarding exception text or browser state. */
export async function browserCheck(check, action) {
  try { return await action(); }
  catch (error) {
    if (error instanceof Error && !failures.has(error)) {
      const isStatus = value => Number.isInteger(value) && value >= 100 && value <= 599;
      const status = httpChecks.has(check) && error instanceof AssertionError && isStatus(error.actual) && isStatus(error.expected)
        ? { actualStatus: error.actual, expectedStatus: error.expected } : {};
      failures.set(error, { check: checks.has(check) ? check : "unclassified", kind: failureKind(error), ...status });
    }
    throw error;
  }
}

export function assertNoAxeViolations(items) {
  const violations = items.filter(item => impacts.has(item.impact)).map(item => ({ id: item.id, impact: item.impact }));
  try { assert.deepEqual(violations, []); }
  catch (error) {
    // This is exclusively the projection made above, never error.actual or an
    // arbitrary assertion array. Omit unknown identifiers even from this list.
    const approved = violations.filter(item => typeof item.id === "string" && ruleIds.has(item.id) && impacts.has(item.impact));
    failures.set(error, {
      check: "accessibility", kind: "assertion", assertion: "axe_violations",
      violations: approved.map(item => ({ id: item.id, impact: item.impact })),
      omittedViolations: violations.length - approved.length,
    });
    throw error;
  }
}

export function assertNoHorizontalOverflow(value) {
  try { assert.equal(value, false); }
  catch (error) {
    failures.set(error, {
      check: "horizontal_overflow", kind: "assertion", assertion: "horizontal_overflow",
      overflow: typeof value === "boolean" ? value : "unclassified",
    });
    throw error;
  }
}

/** Public output is assembled from fixed categories and numeric counters only. */
export function browserFailureDiagnostic(error, diagnostics = {}) {
  const statuses = new Map();
  const responseGroups = new Map();
  for (const response of diagnostics.responses ?? []) {
    const status = response.status;
    if (!Number.isInteger(status) || status < 400 || status > 599) continue;
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
    const routeCategory = responseRouteCategory(response.path);
    const resourceType = resourceTypes.has(response.type) ? response.type : "other";
    const key = `${status}:${routeCategory}:${resourceType}`;
    const group = responseGroups.get(key) ?? { status, routeCategory, resourceType, count: 0 };
    group.count++;
    responseGroups.set(key, group);
  }
  const consoleErrors = { hydration: 0, resource: 0, other: 0 };
  for (const category of diagnostics.console ?? []) {
    if (Object.hasOwn(consoleErrors, category)) consoleErrors[category]++;
  }
  // Outbox subjects and page headings are product copy, never capabilities; keep them short and plain.
  const plain = value => typeof value === "string" ? value.replace(/[^\w .,:'-]/gu, "").slice(0, 80) : null;
  const where = { ...(Array.isArray(diagnostics.outbox) ? { outbox: diagnostics.outbox.slice(0, 5).map(plain) } : {}),
    ...(diagnostics.page ? { page: { path: ["/__dev/outbox", "/auth/confirm", "/signin", "/setup", "/app"].includes(diagnostics.page.path) ? diagnostics.page.path : "other", heading: plain(diagnostics.page.heading) } } : {}) };
  return {
    ...(failures.get(error) ?? { check: "unclassified", kind: failureKind(error) }),
    ...where,
    httpFailures: [...statuses].sort(([a], [b]) => a - b).map(([status, count]) => ({ status, count })),
    httpFailureGroups: [...responseGroups.values()].sort((a, b) => a.status - b.status || a.routeCategory.localeCompare(b.routeCategory) || a.resourceType.localeCompare(b.resourceType)),
    consoleErrors,
  };
}
