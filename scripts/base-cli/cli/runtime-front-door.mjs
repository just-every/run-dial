import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { trafficProxy } from './server-proxy.mjs';

// All public serving, including setup's bounded runtime, uses this listener.
// The adapter receives a separate loopback port and keeps the public origin
// for application URLs, cookies and sign-in links.
// In door mode (`door`) the listener is 127.0.0.1 on a port the OS assigns,
// and only the machine's front door reaches it.
export async function runtimeFrontDoor({ host, port, activity, door, devKey, origin }) {
 const runtimePort = await runtimeLoopbackPort(port);
 const observer = activity ?? { begin: () => () => {}, touch: () => {} };
 const proxy = await trafficProxy({ host, port, target: runtimePort, activity: observer, door, devKey, origin });
 return { ...proxy, runtimePort };
}

// The runtime binds this port strictly, seconds after it is chosen. A port the
// OS assigned to listen(0) comes from its ephemeral range, which meanwhile hands
// ports to every other socket (the runtime's own listeners, outbound requests),
// so the runtime's bind could find it taken. Choose a free port the OS never
// assigns on its own instead.
async function runtimeLoopbackPort(publicPort) {
 const [first, last] = await ephemeralRange();
 const candidates = [[10000, first - 1], [last + 1, 65535]].filter(([low, high]) => low <= high);
 if (!candidates.length) throw Error(`The OS assigns every local port from 10000 (ephemeral range ${first}-${last}); leave part of that space outside the range for the local runtime.`);
 const size = candidates.reduce((total, [low, high]) => total + high - low + 1, 0);
 for (let attempt = 0; attempt < 100; attempt++) {
  let offset = Math.floor(Math.random() * size), candidate;
  for (const [low, high] of candidates) { if (offset <= high - low) { candidate = low + offset; break; } offset -= high - low + 1; }
  if (candidate !== publicPort && await free(candidate)) return candidate;
 }
 throw Error('No free loopback port outside the ephemeral range was found for the local runtime.');
}
async function ephemeralRange() {
 if (process.platform === 'linux') return (await readFile('/proc/sys/net/ipv4/ip_local_port_range', 'utf8')).trim().split(/\s+/).map(Number);
 if (process.platform === 'darwin') return (await promisify(execFile)('/usr/sbin/sysctl', ['-n', 'net.inet.ip.portrange.first', 'net.inet.ip.portrange.last'])).stdout.trim().split(/\s+/).map(Number);
 // Windows' default dynamic range, the IANA range.
 return [49152, 65535];
}
function free(port) {
 const probe = createServer();
 return new Promise(resolve => {
  probe.once('error', () => resolve(false));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
 });
}
