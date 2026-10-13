import { constants } from 'node:os';
import { commandDiagnostic } from '../local-setup/command-diagnostics.mjs';

const stages = new Map([['export', 'archive_export'], ['import', 'archive_import'], ['reset', 'local_reset']]);
const codes = new Set(['restore_refused', 'invalid_archive', 'transfer_failed']);
const reasons = new Set([
  'erasure_epoch', 'erased_row', 'destination_nonempty', 'archive-destination-not-empty',
  'wrong_product', 'schema_mismatch', 'table_inventory', 'configuration_inventory',
  'archive_json', 'native_error', 'incomplete', 'EEXIST', 'ENOENT', 'EACCES', 'ENOSPC',
]);
const number = value => Number.isSafeInteger(value) ? value : null;

// Captured output stays in memory. Only fixed categories and numeric process
// status may leave this boundary, including for unknown or malformed failures.
export function archiveDiagnostic(output, verb, state, phase = 'command') {
  const exitCode = number(state.code);
  const known = commandDiagnostic(output, verb, exitCode);
  const diagnostic = {
    stage: stages.get(verb) ?? 'unclassified', phase: phase === 'cleanup' ? 'cleanup' : 'command',
    code: known.code, reason: 'unclassified', exitCode,
    signal: number(constants.signals[state.signal]),
    spawned: Number(state.spawned === true), exited: Number(state.exited === true), closed: Number(state.closed === true),
    destinationNonempty: Number(output.includes('destination_nonempty') || output.includes('archive-destination-not-empty')),
  };
  if (Number.isSafeInteger(known.childExitCode)) diagnostic.childExitCode = known.childExitCode;
  for (const line of output.split(/\r?\n/)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.version !== 1 || event.event !== 'error' || event.verb !== verb || event.exitCode !== exitCode) continue;
    if (codes.has(event.code)) diagnostic.code = event.code;
    const reason = typeof event.message === 'string'
      ? (/^The portability module refused or failed the archive operation \(([^()\r\n]+)\)\.$/.exec(event.message)
        ?? /^Dial transfer failed \(([^()\r\n]+)\); preserve the archive and inspect the private log\.$/.exec(event.message))?.[1] : undefined;
    diagnostic.reason = codes.has(event.code) && reasons.has(reason) ? reason : 'unclassified';
  }
  return diagnostic;
}
