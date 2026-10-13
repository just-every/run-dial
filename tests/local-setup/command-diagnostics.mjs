import { stripVTControlCharacters } from "node:util";

// CLI JSON messages can contain private captured output. Return only fixed
// categories and numeric exit codes; never forward messages or their excerpts.
const codes = new Set([
  "invalid_invocation", "missing_input", "safety_refusal", "command_failed",
  "invalid_setup_manifest", "cancelled", "outbox_unavailable", "child_failed",
  "transfer_failed", "server_bookkeeping_failed", "app_exited",
]);
const steps = new Map([
  ["installing dependencies", "dependencies"],
  ["setting up the application", "setup"],
  ["building the application", "build"],
  ["verifying the application", "verify"],
  ["starting the application", "start"],
  ["deploying the application", "deploy"],
]);

function buildFailureDiagnostic(message) {
  // Match known failure signatures in memory. Never return their matched text,
  // module specifiers, paths, source frames or any other captured content.
  // The native capture is embedded in error.message, then JSON-escaped by the
  // CLI. Inspect only its decoded output block, excluding the headline/log path.
  const marker = "\nLast output (up to 40 lines):\n";
  const start = message.indexOf(marker), end = message.lastIndexOf("\nLog: ");
  if (start < 0 || end < start) return "unclassified";
  const text = stripVTControlCharacters(message.slice(start + marker.length, end));
  if (/(?:^|\n)AssertionError \[ERR_ASSERTION\]: private Hono diagnostic handlers must remain outside browser chunks; import them in the server composition directly(?:\r?\n|$)/.test(text)) return "client_server_boundary";
  if (/(?:^|\n)AssertionError \[ERR_ASSERTION\]: build output must not package \.dev\.vars(?:\r?\n|$)/.test(text)) return "credential_output";
  if (/\[vite\]: (?:Rollup|Rolldown) failed to resolve import |\b(?:UNRESOLVED_IMPORT|UNRESOLVED_ENTRY)\b|(?:^|\n)(?:Error: )?Could not resolve ["']/.test(text)) return "unresolved_import";
  if (/\b(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND)\b|(?:^|\n)(?:Error: )?Cannot find (?:module|package) ["']/.test(text)) return "missing_module";
  if (/\bPARSE_ERROR\b|(?:^|\n)(?:SyntaxError:|(?:Error: )?Parse error\b)|Transform failed with [1-9]\d* errors?:|\berror TS\d+:/.test(text)) return "compile_error";
  return "unclassified";
}

export function commandDiagnostic(output, verb, exitCode) {
  const diagnostic = { code: "unclassified", stage: "unclassified", exitCode };
  for (const line of output.split(/\r?\n/)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.version !== 1 || event.verb !== verb || event.exitCode !== exitCode) continue;
    if (event.event === "result" && Number.isInteger(event.childExitCode)) diagnostic.childExitCode = event.childExitCode;
    if (event.event !== "error") continue;
    diagnostic.code = codes.has(event.code) ? event.code : "unclassified";
    delete diagnostic.buildFailure;
    if (typeof event.message !== "string") continue;
    let eventStage;
    for (const [phrase, stage] of steps) {
      if (event.message.split("\n").some(text => text.startsWith(`Installation stopped while ${phrase}. Ask your agent to check the edition's operating command for that step,`))) {
        diagnostic.stage = stage;
        eventStage = stage;
      }
    }
    if (event.code === "command_failed" && eventStage === "build") diagnostic.buildFailure = buildFailureDiagnostic(event.message);
    if (diagnostic.stage === "setup") {
      if (event.message.startsWith("Claiming the first owner: ")) diagnostic.stage = "owner_claim";
      if (event.message.startsWith("Opening sign-in through the development outbox: ")) diagnostic.stage = "sign_in";
    }
    if (diagnostic.code === "command_failed" && event.message.split("\n", 1)[0] === "Opening sign-in through the development outbox: HTTP 429 (rate_limited).") {
      diagnostic.httpStatus = 429;
      diagnostic.authReason = "rate_limited";
    }
  }
  return diagnostic;
}
