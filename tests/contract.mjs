import test from "node:test";

/** The title format `pnpm verify` scans to map a test onto a contract clause. */
export function contractTitle(id, name) {
  return `[${id}] ${name}`;
}

/** Tag a behavioural test with the contract clause it proves. */
export function contract(id, name, fn) {
  return test(contractTitle(id, name), fn);
}
