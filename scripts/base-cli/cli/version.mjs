// The rer CLI version: one source (global/package.json in Base) for the npm
// package, `rer --version` and the version a vendored copy records. A commit
// tagged rer-v<version> is that version; any other commit stamps
// <version>-dev.g<sha8>, which sorts below the release.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageName = '@runeditrun/rer';
const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } };

export function stampedVersion(base, version, revision = 'HEAD') {
 const git = args => execFileSync('git', ['-C', base, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
 if (git(['tag', '--points-at', revision]).split('\n').includes(`rer-v${version}`)) return version;
 return `${version}-dev.g${git(['rev-parse', '--short=8', revision])}`;
}

// The version of the rer source at `root`: a packed @runeditrun/rer carries it
// in its package.json; a Base checkout derives it from its version source and
// Git. undefined for a source tree without the version source.
export function cliVersion(root) {
 const packed = readJson(join(root, 'package.json'));
 if (packed?.name === packageName) return packed.version;
 const source = readJson(join(root, 'global/package.json'));
 return source ? stampedVersion(root, source.version) : undefined;
}

// The version a vendored copy recorded (scripts/base-cli/inventory.json), else
// the version of the rer source this file belongs to. undefined for a vendored
// copy too old to record one.
export function runningVersion() {
 const vendored = readJson(new URL('../inventory.json', import.meta.url));
 if (vendored) return vendored.cliVersion;
 return cliVersion(fileURLToPath(new URL('..', import.meta.url)));
}
