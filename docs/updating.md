# Updating

Dial is source code that you own. A new version arrives as new commits in the upstream repository, `https://github.com/just-every/run-dial`, with notes on what changed and what to do about it. You pull them from there and merge them into your copy when you choose. This page shows how to take an update without losing data or your own changes.

## How updates arrive

Each version of Dial ships three things you read before you change anything:

- **[CHANGELOG.md](../CHANGELOG.md)** says what changed in plain language, including anything that breaks.
- **[RELEASE.json](../RELEASE.json)** is the exact record for your agent: which behaviors changed, whether the update breaks anything, each database migration with its steps, and written instructions for the agent that applies the update.
- **[HANDOVER.md](../HANDOVER.md)** says what has and has not been proven, so you know the limits of that version.

Dial does not check for updates or phone home. Nothing changes on your install until you apply it.

## Your changes are yours

You and your coding agent may change any part of Dial: the screens, the rules, the database, the infrastructure. Dial does not lock down a core and an extension area. When an update touches code you have changed, merging, reapplying your changes or rewriting is work for your agent, and it chooses the method. What matters is the result, which is that the updated Dial still does what you asked for.

Whichever way you take an update, keep your own changes and every authored record. Check the result against the behavior you want before you deploy it. Do not regenerate the code over your work.

## Update safely

1. **Read the notes.** Open the changelog and `RELEASE.json`. Look for `breaking` changes and for new migrations since your version. Note anything that asks operators to sign in again.
2. **Back up first.** On your computer, stop dev with `rer dev --stop` (or preview with `rer preview --stop`) and run `rer export --output exports/dial-before-update.rer` with a new filename, then check that the file exists. A migration cannot be undone by deploying the old code, so the archive is your way back. For a hosted install, use the authenticated hosted export in [Backups and export](backups.md) and rehearse an empty local restore. Use the same source revision for that restore rehearsal, before applying the update. Retain `.rer/deploy/production.json`, the exact source revision and original private settings separately; a deployment receipt is not a data backup.

   **From v0.1.0 without pnpm on PATH:** that version's `rer export` needs pnpm **10.12.4** for the entire export, even if `rer dev` fetched it earlier. From the old checkout, use this command instead of the plain export above. npm supplies the pinned pnpm on PATH for this command without a global installation:

   ```bash
   npm exec --yes --package=pnpm@10.12.4 -- \
     rer export --output exports/dial-before-v0.2.0.rer
   ```

3. **Bring the new source in.** Let your agent merge it with your changes, then run the project's checks. They run lint, types, the tests, a replay of the migrations on a local database, the build and accessibility checks on the booking pages. They need a Chromium for Playwright, installed by the first command, and they listen on fixed local ports: free every port that `fixturePortRanges` lists in [scripts/ci-runtime-ports.mjs](../scripts/ci-runtime-ports.mjs) first.

   ```bash
   pnpm exec playwright \
     install chromium
   pnpm run verify
   ```

4. **Apply migrations in order.** Migrations are numbered SQL files in `migrations/core`. They run in filename order. Your agent should never run one out of order or skip one.
5. **Never edit an applied migration.** A migration that has already run on your install is fixed, down to the byte. To change the database again, add a new migration with the next number. The deploy refuses to proceed if the migrations your install has already run are not an unchanged start of the new list.
6. **Deploy.** For a local install, run setup again, which rebuilds and applies new migrations while keeping your owner, data and settings, then start Dial:

   ```bash
   rer setup
   rer dev
   ```

   For Cloudflare, commit the merged source and deploy from the checkout that holds your deploy record, with the same `--environment` as before, because a new environment makes a new install. Deploy reuses the resources it created, applies only the new migrations, uploads the new Worker and checks health. Your existing secrets are kept by name.

   ```bash
   rer deploy --environment production
   ```

7. **Check it.** Sign in and walk through a booking on a test event type. Running `rer deploy --environment production` again with the same build changes nothing and checks health again.

If a migration was interrupted partway, Dial will not replay it by itself. It stops and asks you to review the state first. Restore from your archive into a fresh install if you cannot tell what happened. Also see [Backups and export](backups.md#restore-into-an-empty-install).

If deploy stops with `owned-resource-replaced`, the live Worker is no longer the version Dial last deployed, for example after secrets were saved in the Cloudflare dashboard. Deploy never overwrites a version it cannot account for, so ask your agent to explain the refusal before you change anything in Cloudflare.

## Keeping your settings

An update should keep your authored data, event types, settings and secrets. Local setup preserves your existing `.dev.vars` file exactly, and a Cloudflare deploy keeps existing secrets by name. A required setting that is missing makes Dial fail loudly and name what is missing, rather than quietly running without it.

## What to do when something looks wrong

Stop, and do not edit applied migrations to make an error go away. Read the error, compare it with `RELEASE.json`, and ask your agent to explain which step failed. If you took an archive in step 2, you can always rebuild a known good local Dial from it.
