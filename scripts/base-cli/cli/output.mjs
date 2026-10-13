import { writeSync } from 'node:fs';
export function output(options) {
 let closed = false, finished = false;
 // A bounded child retains the caller's human progress but sends its closing
 // outcome as data, so only the drained outer workflow renders the result.
 const structuredResult = options.json || process.env.RER_BOUNDED_OUTPUT === '1';
 const write = (fd, text) => { if (closed && fd === 1) return; try { writeSync(fd, text); } catch (error) { if (error.code === 'EPIPE') closed = true; else if (!['EAGAIN', 'EWOULDBLOCK'].includes(error.code)) throw error; } };
 return {
  event(event, details = {}) { write(1, JSON.stringify({ version: 1, verb: options.verb ?? 'unknown', event, ...details }) + '\n'); },
  human(text) { write(1, text + '\n'); },
  progress(text) { write(2, text); },
  result(ok, exitCode, details = {}) {
   if (finished) throw Error('Duplicate CLI result'); finished = true;
   if (structuredResult) this.event('result', { ok, exitCode, ...details });
   else if (!['describe', 'check', 'dev', 'preview', 'outbox', 'setup'].includes(options.verb) || !ok) this.human(`${options.verb}: ${ok ? 'complete' : 'failed'} (exit ${exitCode})`);
  },
  error(error) {
   if (structuredResult) this.event('error', { code: error.code, message: error.message, exitCode: error.exitCode });
   else write(2, error.message + '\n');
  },
 };
}
