# Owner-session command runner

Run `node scripts/owner-session/run.mjs --dry-run live` to inspect command dispatch
without a private workspace, credential reads, child processes or network calls.
The output contains the fixed script and action, never supplied argument values.
Every supported command has the same offline mode.

For an authorized owner-attended session, supply `--workspace /absolute/private/workspace`
before the command (or set `DIAL_OWNER_SESSION_WORKSPACE`). The workspace contains
its reviewed `owner-session/` and `disposable/` helpers and its private receipts;
the repository dispatcher never creates or substitutes provider helpers. Use the
workspace's owner-session instructions for preparation, scoped authorization,
Google consent and teardown. `--check` checks local helper syntax and source paths
only. Neither check mode nor dry-run proves provider acceptance.

The workspace wrapper should call `runCli` from this module so its commands and
redacted journals cannot diverge from the repository dispatcher. Live commands
retain one-shot journals and receipt custody. A failed or ambiguous provider
operation requires investigation; never blindly replay it. Supply secrets through
private files or the provider's encrypted settings, never chat or command arguments.

`node scripts/owner-session/run.mjs --live-rows` prints, offline, the attended
session's rows in order: only the clauses a live Google or SendGrid account can
prove (the lifecycle clause ledger in `ACCEPTANCE.md` holds the rest). Each row
names what the owner does, the observable pass condition and the command that
records it; `observe ROW` runs the workspace's `owner-session/observe.mjs`.

