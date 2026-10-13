import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const portable = basename(dirname(fileURLToPath(import.meta.url))) === 'base-onboarding';
const keys = () => import(new URL(portable ? '../base-cli/cli/dev-identity.mjs' : '../cli/dev-identity.mjs', import.meta.url));

// A seed declares devIdentity once, on the commandAdapter its OPERATIONS.json
// names; the installer reads that declaration instead of asking for a second one.
// Only a checkout with no OPERATIONS.json or no seed contract is not a devIdentity seed.
export async function declaresDevIdentity(root) {
 let descriptor;
 try { descriptor = JSON.parse(await readFile(join(root, 'OPERATIONS.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
 const file = descriptor.seedContract?.adapter;
 return typeof file === 'string' && Boolean((await import(pathToFileURL(resolve(root, file)).href)).commandAdapter?.devIdentity);
}

// The checkout's dev key for a devIdentity seed's installer, created as rer setup
// does, or null for any other seed. The temporary app must receive it (the start
// hook's context.devKey) so its key-gated outbox answers the installer's sign-in.
export async function installerDevKey(root) {
 return await declaresDevIdentity(root) ? (await keys()).ensureDevKey(root) : null;
}
