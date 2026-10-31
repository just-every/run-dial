import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Fixed native listeners must not be assigned to Miniflare's port-0 loopback
// servers or HTTP clients before the corresponding fixture binds its socket.
// Linux's default 32768-60999 range includes the 41868/41890/42000 listeners.
// https://docs.kernel.org/networking/ip-sysctl.html#ip-variables
export const fixturePortRanges = "8787,15700-15741,15750-15756,15762-15767,15770-15771,15802-15805,41868,41890,42000-42001";
const reservedPortsPath = "/proc/sys/net/ipv4/ip_local_reserved_ports";

export function parsePortRanges(value) {
  const ports = new Set();
  if (!value.trim()) return ports;
  for (const entry of value.trim().split(",")) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(entry);
    if (!match) throw new Error(`Invalid reserved port range: ${entry}`);
    const first = Number(match[1]), last = Number(match[2] ?? match[1]);
    if (first < 0 || last > 65535 || first > last) throw new Error(`Invalid reserved port range: ${entry}`);
    for (let port = first; port <= last; port++) ports.add(port);
  }
  return ports;
}

export function mergeReservedPorts(existing) {
  // Reading before writing preserves reservations supplied by the runner.
  const ports = [...new Set([...parsePortRanges(existing), ...parsePortRanges(fixturePortRanges)])].sort((a, b) => a - b);
  const ranges = [];
  for (let index = 0; index < ports.length; index++) {
    const first = ports[index];
    let last = first;
    while (ports[index + 1] === last + 1) last = ports[++index];
    ranges.push(first === last ? String(first) : `${first}-${last}`);
  }
  return ranges.join(",");
}

export function assertFixturePortsReserved(value) {
  const reserved = parsePortRanges(value);
  const missing = [...parsePortRanges(fixturePortRanges)].filter((port) => !reserved.has(port));
  if (missing.length) throw new Error(`Native fixture ports missing from ip_local_reserved_ports: ${missing.join(",")}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const value = await readFile(reservedPortsPath, "utf8");
  if (process.argv[2] === "--check") {
    assertFixturePortsReserved(value);
    console.log("All native fixture listeners are excluded from automatic port assignment.");
  } else if (process.argv.length === 2) {
    console.log(mergeReservedPorts(value));
  } else {
    throw new Error("Usage: node scripts/ci-runtime-ports.mjs [--check]");
  }
}
