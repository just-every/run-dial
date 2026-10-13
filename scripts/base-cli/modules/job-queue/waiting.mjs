import { GIB } from './config.mjs';

const gib = bytes => `${(bytes / GIB).toFixed(1)} GiB`;

// What a queued job tells the person: its place, who is ahead of it (with their
// checkout paths), memory against the floor, and how to change that floor.
export function waitingMessage(wait) {
  const lines = [`Waiting to start (queue position ${wait.position}/${wait.queued}): ${wait.reason}.`];
  if (wait.ahead?.length) {
    lines.push(`Ahead of this job:`);
    for (const job of wait.ahead) lines.push(`  ${job.state}: ${job.label} in ${job.repository}`);
  }
  if (Number.isFinite(wait.resources?.availableMemoryBytes))
    lines.push(`Memory: ${gib(wait.resources.availableMemoryBytes)} available, floor ${gib(wait.limits.minFreeMemoryBytes)}. Change the floor with RER_JOBS_MIN_FREE_MEMORY_BYTES (bytes; 0 for no floor).`);
  return lines.join('\n');
}
