import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const record = JSON.parse(await readFile('scripts/base-cli/inventory.json'));
let checked = 0;
for (const [root, files] of [['scripts/base-cli', record.files], ['scripts/base-onboarding', record.onboardingFiles]]) {
 for (const [path, value] of Object.entries(files)) {
  if (createHash('sha256').update(await readFile(join(root, path))).digest('hex') !== value.sha256) throw Error(`Changed Base runtime: ${root}/${path}`);
  checked++;
 }
 const paths = await readdir(root, { recursive: true });
 if (paths.some(path => /(^|\/)(tests?|fixtures)(\/|$)|\.test\./.test(path))) throw Error(`Copied Base tests remain under ${root}`);
}
console.log(`Verified ${checked} exact Base CLI/onboarding runtime files; no copied suites.`);
