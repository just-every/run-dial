import { mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const repository = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
function outsideRepository(path) {
  const inside = relative(repository, path);
  if (!inside || (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside))) throw new Error("verification-evidence-must-be-outside-repository");
  return path;
}
const configured = outsideRepository(resolve(process.env.DIAL_EVIDENCE_DIR ?? resolve(tmpdir(), "dial-verification-evidence")));
mkdirSync(configured, { recursive: true });
export const evidenceDirectory = outsideRepository(realpathSync(configured));
process.env.DIAL_EVIDENCE_DIR = evidenceDirectory;
export function externalEvidencePath(path) {
  const target = outsideRepository(resolve(path));
  mkdirSync(dirname(target), { recursive: true });
  outsideRepository(realpathSync(dirname(target)));
  // An existing destination can itself be a symlink into tracked inputs.
  try { outsideRepository(realpathSync(target)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  return target;
}
export function evidencePath(name) {
  const target = resolve(evidenceDirectory, name);
  const child = relative(evidenceDirectory, target);
  if (!child || child.startsWith(`..${sep}`) || child === ".." || isAbsolute(child)) throw new Error("invalid-evidence-path");
  return externalEvidencePath(target);
}
