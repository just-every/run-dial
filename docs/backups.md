# Backups and export

Dial can write all the data of an install on your computer to one private archive file, and restore that file into a fresh, empty install. Use it for backups and before every update. The data is yours, and it leaves in a plain, documented format.

> [!NOTE]
> This version exports and restores local installs only. Exporting from or restoring into a deployed install is not supported yet: those commands stop with exit code 4 before contacting Cloudflare. The local round trip is covered by automated tests, so rehearse your first restore before you need it.

## Two commands

```bash
pnpm run export -- \
  --output exports/dial.rer
pnpm run import -- \
  --input exports/dial.rer --yes
```

Use `pnpm run import`, not `pnpm import`. Plain `pnpm import` is a different built-in pnpm command that converts another package manager's lockfile. The extra `run` selects Dial's restore command.

Stop `pnpm run dev` or `pnpm run preview` before you export or import. Archives live in the `exports/` folder of your Dial checkout, which git ignores and reset keeps. Give each new export a `.rer` name inside it so the CLI can verify that the dev server will not serve it. Dial refuses paths outside this folder.

Export writes a new file that only you can read, and it refuses to overwrite an existing one, so give each archive its own name. Keep the archive private: it contains your clients' names, emails and answers. Add `--json` to either command to see the archive's `contentHash`, which identifies its contents.

## What the archive contains

Everything durable:

- Operators, your host profile and your event types, with their questions, availability windows and date overrides.
- Bookings and every time they have been moved to, with the invitee's answers, attendance marks and the history of changes.
- Alternative requests, delivery attempts, settings and the audit trail.
- Calendar connection details and sync state, without the credentials.

Each part of the archive is checked before restore, and an archive whose tables do not match this version of Dial is refused.

## What it leaves out

The archive never holds a secret or a live key.

- No Google access or refresh credentials, no sessions, no sign-in or invitation links, no setup or webhook secrets.
- No private manage links for bookings, and no saved email bodies that contain them.
- Nothing from the local development outbox.
- Not your private settings in `.dev.vars`, including your session secret.

Your Cloudflare token, SendGrid key and Google client secrets are not in the archive either. Keep them wherever you already keep them.

## Keep your session secret

Dial uses the `SESSION_SECRET` in `.dev.vars` to match retry and erasure records for bookings, and a restore refuses settings whose secret does not match the archive. Keep a private copy of `.dev.vars` with your archives, never inside the archive itself and never in git. Reset removes `.dev.vars`, so copy it first.

## Restore into an empty install

Restore only works into an install that has no data at all: no owner, no rows and no files.

1. Stop `pnpm run dev` or `pnpm run preview`.
2. Empty the destination. In an existing checkout, reset it:

   ```bash
   pnpm run reset -- --yes
   ```

   In a fresh checkout, install the dependencies instead, and do not run setup, because setup creates an owner:

   ```bash
   pnpm run deps
   ```

3. Put your original `.dev.vars` back in the checkout root, readable only by you.
4. Put the archive in `exports/`, readable only by you, and run the import command above. Import applies the migrations itself, checks the whole archive, then restores it.
5. Run setup with the original owner's email, start Dial, and sign in through the local outbox:

   ```bash
   pnpm run setup -- \
     --owner-email you@example.com
   pnpm run dev
   ```

To prove the round trip, export again with `--json` and compare the new `contentHash` with the first one. They match when the data is the same.

If a restore fails, keep the archive, do not use that destination, and start again from step 2.

An archive in the older format that earlier versions of Dial wrote cannot be imported here. Restore it with the version of Dial that wrote it, update that install, then export again.

## After you restore

A restore brings your data back, not your live connections. Expect to do these:

- **Sign in again.** Your operators are all there, but sessions and links are not. Each operator requests a fresh magic link. The first owner is already claimed, so it cannot be claimed a second time.
- **Reconnect Google Calendar.** Open **Settings** and connect again. The calendar shows as needing attention until you do, and event types cannot be published or offer times in the meantime. Your chosen calendars are remembered.
- **Check mail.** Run **Check sender** in **Settings**. Mail health is reset until you do.
- **Old manage links stop working.** Restore never recreates them. Clients can no longer use the private links from earlier emails. If a client needs to change a booking, you can reschedule or cancel it for them from **Bookings**.
- **Nothing is replayed.** Emails and calendar changes that were pending at backup time come back marked as failed, with the reason that they are historical. Restore sends no mail and touches no calendar.

Read [Calendar and email](calendar-and-email.md) for the connection steps.
