# Run it locally

From this checkout root, use Node 22.20.0 and pnpm 10.12.4:

```sh
node scripts/rer.mjs install
node scripts/rer.mjs setup --owner-email you@example.com
node scripts/rer.mjs dev
```

`dev` prints `RER_SIGNED_IN EMAIL` and `RER_OPEN URL`: open that URL on this
computer and Dial opens signed in as the owner (treat the line as a credential;
`dev --as co-host` or `signed-out` starts as someone else, `dev --login` uses
the outbox email link instead, and no external email is sent). A fresh owner's
first sign-in opens
authenticated `/setup`; see `OPERATIONS.md` for completion. Stop dev with
`node scripts/rer.mjs dev --stop` or Ctrl-C before running:

```sh
node scripts/rer.mjs verify
node scripts/rer.mjs export --output exports/dial.rer
node scripts/rer.mjs reset --yes
node scripts/rer.mjs import --input exports/dial.rer --yes
node scripts/rer.mjs setup --owner-email you@example.com
node scripts/rer.mjs deploy --dry-run
node scripts/rer.mjs describe
```

Save private settings securely before reset and restore them, including the
same `SESSION_SECRET`, before import. Export before reset; import requires an
empty destination and explicit confirmation. A live deployment is an explicit
owner-account action; see [OPERATIONS.md](OPERATIONS.md) for the full effects.

# Repository instructions

Read and follow [AGENTS.md](AGENTS.md) before changing this checkout.
