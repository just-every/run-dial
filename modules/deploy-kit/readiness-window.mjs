import { AsyncLocalStorage } from 'node:async_hooks';
import { assert } from './validation.mjs';

// A single, in-memory deadline travels with this upload. It is deliberately not
// persisted: an old receipt is not evidence of a fresh propagation window.
export function readinessWindow({ totalMs = 90000, clock = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
 assert(Number.isFinite(totalMs) && totalMs > 0 && totalMs <= 90000, 'invalid-health-bound');
 let start;
 return {
  clock, sleep,
  get active() { return start !== undefined; },
  start() { start ??= clock(); },
  remaining() { return start === undefined ? totalMs : Math.max(0, totalMs - (clock() - start)); },
  async pause() { const left = this.remaining(); if (left > 0) await sleep(Math.min(2000, left)); },
 };
}

// Custom deploy hooks can claim before returning their result. Keep the proof
// inside their current observation scope, never in a process-global cache.
const observations = new AsyncLocalStorage();
export const observeReadiness = run => observations.getStore() ? run() : observations.run(new Map(), run);
export const rememberReadiness = deployed => observations.getStore()?.set(deployed.origin, deployed);
export const observedReadiness = origin => observations.getStore()?.get(origin);

export function readinessAPI(api, window, failure = 'deployment-readiness-timeout') {
 return {...api, request(path, options = {}) {
  const remaining = window.remaining();
  assert(remaining > 0, failure);
  const deadline = AbortSignal.timeout(Math.max(1, Math.ceil(remaining)));
  return api.request(path, {...options, signal:options.signal ? AbortSignal.any([options.signal,deadline]) : deadline});
 }};
}
