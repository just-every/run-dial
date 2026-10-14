# Run it locally

From this checkout root, use Node 22.20.0 and pnpm 10.12.4:

```sh
rer install
rer setup --owner-email you@example.com
rer dev
```

`dev` prints `RER_SIGNED_IN EMAIL` and `RER_OPEN URL`: open that URL on this
computer and Dial opens signed in as the owner (treat the line as a credential;
`dev --as co-host` or `signed-out` starts as someone else, `dev --login` uses
the outbox email link instead, and no external email is sent). A fresh owner's
first sign-in opens
authenticated `/setup`; see `OPERATIONS.md` for completion. Stop dev with
`rer dev --stop` or Ctrl-C before running:

```sh
rer verify
rer export --output exports/dial.rer
rer reset --yes
rer import --input exports/dial.rer --yes
rer setup --owner-email you@example.com
rer deploy --dry-run
rer describe
```

Save private settings securely before reset and restore them, including the
same `SESSION_SECRET`, before import. Export before reset; import requires an
empty destination and explicit confirmation. A live deployment is an explicit
owner-account action; see [OPERATIONS.md](OPERATIONS.md) for the full effects.

# Repository instructions

Read and follow [AGENTS.md](AGENTS.md) before changing this checkout.
