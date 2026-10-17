// Project only fixed native CLI categories. Captured output may contain
// private settings, management capabilities or provider diagnostics, so never
// attach it (or a substring of it) to a public test failure.
const fixedRefusals = new Map([
  ["Server startup requires 15 GiB free on checkout and temporary volumes. Recover owned space before retrying.", "insufficient_disk"],
  ["Invalid server load threshold.", "invalid_load_threshold"],
  ["An active local operation owns the state. Stop it before retrying.", "local_operation_busy"],
  ["Local state placement is unsafe or ambiguous. Preserve legacy state and recover it explicitly before retrying.", "unsafe_local_state"],
  ["Saved origin is malformed. Restore private settings or use confirmed reset.", "malformed_saved_origin"],
  ["Saved origin is unsafe. Restore private settings or use confirmed reset.", "unsafe_saved_origin"],
  ["Server registry directory is foreign or linked. Preserve it and choose an owned RER_SERVERS_DIR.", "unsafe_registry_directory"],
  ["Server registry state is foreign or linked. Preserve it for inspection.", "unsafe_registry_state"],
  ["Registered application failed health verification. Stop it before retrying.", "registered_health_failed"],
  ["Concurrent server startup failed. Retry after recovery.", "concurrent_startup_failed"],
  ["The existing server is still starting. Wait for its ready output.", "existing_server_starting"],
]);
const dynamicRefusals = [
  [/^Not started: this computer is busy\. Its 1-minute load is (?:\d+(?:\.\d+)?|unknown) and a server starts only at (?:\d+(?:\.\d+)?) or below\.$/, "machine_load"],
  [/^Server startup requires (?:\d+(?:\.\d+)?) GiB free on checkout and temporary volumes, and /, "insufficient_disk"],
  [/^Server startup requires machine load at or below (?:\d+(?:\.\d+)?)\. Retry when the machine is available\.$/, "machine_load"],
  [/^Requested port \d+ is unavailable\. Stop its owner or choose an explicit free port; rer does not drift\.$/, "port_unavailable"],
  [/^Server limit \d+ reached\. /, "server_limit"],
  [/^Unverifiable server identity: /, "unverifiable_server_identity"],
  [/^Server lifetime cannot be verified: /, "unverifiable_server_lifetime"],
  [/^This checkout already owns /, "checkout_already_serving"],
  [/^Options conflict with /, "server_options_conflict"],
  [/^Cannot verify managed server /, "unverifiable_managed_server"],
  [/^Server became active before eviction: /, "eviction_refused"],
];
const phases = new Map([
  ["Building production output.", "production_build"],
  ["Building fixed production output", "production_build"],
  ["Reusing intact production output.", "production_output_reuse"],
  ["Starting your application on this computer", "runtime_start"],
  ["Opening sign-in through the development outbox", "sign_in"],
  ["Your application is running locally", "complete"],
]);

export function startupDiagnostic(output, exitCode) {
  const lines = output.split(/\r?\n/);
  if (exitCode !== 4) {
    const diagnostic = { exitCode };
    for (const line of lines) {
      const phase = phases.get(line);
      if (phase) diagnostic.phase = phase;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event?.version === 1 && event.verb === "build" && event.event === "result"
          && typeof event.ok === "boolean" && Number.isInteger(event.exitCode)) {
        diagnostic.buildSucceeded = event.ok && event.exitCode === 0;
      }
    }
    return diagnostic;
  }
  const refusalLines = lines.flatMap(line => {
    try {
      const event = JSON.parse(line);
      if (event?.version === 1 && ["dev", "preview"].includes(event.verb)
          && event.event === "error" && event.code === "safety_refusal" && event.exitCode === 4
          && typeof event.message === "string") return event.message.split(/\r?\n/);
    } catch { /* Human output is classified by the same fixed categories. */ }
    return [line];
  });
  for (const line of refusalLines) {
    const reason = fixedRefusals.get(line) ?? dynamicRefusals.find(([pattern]) => pattern.test(line))?.[1];
    if (reason) return { code: "safety_refusal", reason, exitCode };
  }
  return { exitCode, reason: "unclassified_refusal" };
}
