import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { assertCredentialFree } from "../../modules/deploy-kit/prepare.mjs";
import { assert } from "../../modules/deploy-kit/validation.mjs";

function outside(root, path) {
  const within = relative(root, path);
  assert(within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within), "prepare-tmpdir-must-be-outside-checkout");
}
async function temporaryDirectory(value, root) {
  assert(typeof value === "string" && isAbsolute(value), "prepare-tmpdir-must-be-absolute");
  const checkout = await realpath(root), target = resolve(value);
  outside(checkout, target);
  // Resolve the nearest existing ancestor before creating anything: a symlink
  // outside the checkout must not redirect directory creation into source.
  let ancestor = target;
  for (;;) {
    try { outside(checkout, await realpath(ancestor)); break; }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      ancestor = dirname(ancestor);
    }
  }
  await mkdir(target, { recursive: true, mode: 0o700 });
  const canonical = await realpath(target);
  outside(checkout, canonical);
  assert((await stat(canonical)).isDirectory(), "prepare-tmpdir-must-be-directory");
  return canonical;
}

export async function cleanBuildEnvironment(env, root) {
  assertCredentialFree(env);
  return {
    PATH: env.PATH, HOME: env.RER_PREPARE_HOME, XDG_CONFIG_HOME: env.RER_PREPARE_HOME,
    CI: "true", WRANGLER_SEND_METRICS: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    ...(env.TMPDIR === undefined ? {} : { TMPDIR: await temporaryDirectory(env.TMPDIR, root) }),
  };
}
