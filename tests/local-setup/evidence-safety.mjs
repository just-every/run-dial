import { browserFailureDiagnostic } from "./browser-diagnostics.mjs";

const phases = new Set([
  "browser launch", "sign-in page", "first operator setup", "command-issued outbox",
  "link request", "outbox listing", "outbox message open", "outbox sign-in link", "confirmation page", "confirmation evidence",
  "confirm sign-in", "confirmed destination", "confirmed session", "confirmed accessibility",
  "signed-in callback", "return to setup", "signed-in evidence", "sign out", "browser console checks",
  "expired-link recovery", "browser cleanup", "first-run empty installation",
  "first-run private document guard", "first-run profile editor", "first-run profile save",
  "first-run settings navigation", "first-run authenticated server function guard",
  "first-run anonymous server function guard", "first-run mail connection check", "first-run event editor",
  "first-run event save", "first-run request publication", "first-run booking link copy",
  "first-run completion checklist", "first-run finish setup", "first-run completion persistence",
]);

/** Browser exceptions can include URLs, filled values and DOM fragments. */
export function safeBrowserFailure(phase, width, error, diagnostics) {
  const safePhase = phases.has(phase) ? phase : "unclassified";
  const safeWidth = Number.isSafeInteger(width) && width >= 0 ? width : 0;
  const diagnostic = browserFailureDiagnostic(error, diagnostics);
  return new Error(`Local sign-in browser check failed during ${safePhase} at ${safeWidth}px; diagnostic=${JSON.stringify(diagnostic)}; sensitive browser diagnostics omitted.`);
}

/** Only document pixels are saved; expanded mail is never an evidence surface. */
export function assertSafeEvidenceSurface(url, visibleText, secrets = []) {
  const location = new URL(url);
  const approved = ["/app", "/setup", "/auth/confirm"].includes(location.pathname)
    || (location.pathname === "/__dev/outbox" && location.search === "");
  if (!approved || /\/auth\/confirm\?token=|[?&]token=/i.test(visibleText)
      || secrets.filter(Boolean).some(secret => visibleText.includes(secret))) {
    throw new Error("Refusing an evidence image containing sensitive content or an unapproved surface.");
  }
}
