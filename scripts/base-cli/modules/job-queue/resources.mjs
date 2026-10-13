import { loadavg, freemem } from 'node:os';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// macOS keeps little memory "free" on purpose: free pages are the last thing it
// holds. Inactive, speculative and purgeable pages are reclaimed on demand, so
// the memory a new job can actually use is their sum with the free pages.
// (Purgeable pages can already sit in the inactive count; they are a small
// share, so the overlap only makes the reading slightly generous.)
export function parseVmStat(text) {
  const size = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const pages = name => Number(new RegExp(`^Pages ${name}:\\s+(\\d+)\\.`, 'm').exec(text)?.[1]);
  const total = ['free', 'inactive', 'speculative', 'purgeable'].map(pages);
  if (!Number.isInteger(size) || total.some(value => !Number.isFinite(value))) return NaN;
  return total.reduce((sum, value) => sum + value, 0) * size;
}

// Linux reports the same idea directly as MemAvailable, in kibibytes.
export function parseMemAvailable(text) {
  const kib = Number(/^MemAvailable:\s+(\d+) kB/m.exec(text)?.[1]);
  return Number.isFinite(kib) ? kib * 1024 : NaN;
}

export function availableMemory() {
  try {
    if (process.platform === 'darwin') return parseVmStat(execFileSync('/usr/bin/vm_stat', { encoding: 'utf8', timeout: 3000 }));
    if (process.platform === 'linux') return parseMemAvailable(readFileSync('/proc/meminfo', 'utf8'));
    return freemem();
  } catch { return NaN; }
}

// Built-in OS counters; injection belongs to library tests, never CLI admission.
// freeMemoryBytes is the raw OS free counter, kept for display only: admission
// uses availableMemoryBytes.
export function sampleResources() {
  return { load: loadavg()[0], freeMemoryBytes: freemem(), availableMemoryBytes: availableMemory() };
}
