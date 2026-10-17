import { loadavg } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

// A long CLI journey can reach a new serving start after the fleet load changes.
// Honor the same configured admission guard before launching, without changing it.
export async function waitForServerLoad(env, deadline) {
  const threshold = Number(env.RER_SERVERS_LOAD_THRESHOLD ?? Infinity);
  if (!Number.isFinite(threshold) || threshold < 0) return;
  while (loadavg()[0] > threshold) {
    if (Date.now() >= deadline) throw new Error('Configured server load guard did not open within twenty minutes.');
    await delay(60_000);
  }
}
