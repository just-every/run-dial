# Backups and export

Dial can write the durable data of a local or hosted install to one private archive file, and restore that file into a fresh, empty local install. Use it for backups and before every update. The data is yours, and it leaves in a plain, documented format.

> [!NOTE]
> Hosted export uses your running Dial application and a native owner session. Hosted restore is not exposed. Rehearse restoration into an empty local installation; no live Cloudflare deployment or provider recovery is implied by the local hosted-stand-in tests.

## Two commands

```bash
pnpm run export -- \
  --output exports/dial.rer
pnpm run import -- \
  --input exports/dial.rer --yes
```

Use `pnpm run import`, not `pnpm import`. Plain `pnpm import` is a different built-in pnpm command that converts another package manager's lockfile. The extra `run` selects Dial's restore command.

Stop `pnpm run dev` or `pnpm run preview` before you export or import. Archives live in the `exports/` folder of your Dial checkout, which git ignores and reset keeps. Give each new export a `.rer` name inside it so the CLI can verify that the dev server will not serve it. An absolute output path outside the checkout is also accepted; served and tracked paths are refused.

Export writes a new file that only you can read, and it refuses to overwrite an existing one, so give each archive its own name. Keep the archive private: it contains your clients' names, emails and answers. Add `--json` to either command to see the archive's `contentHash`, which identifies its contents.

## Export from a hosted install

1. Sign in to your hosted Dial as an owner through the normal email link.
2. Open **Settings → Export status** and choose **Download backup**.
3. Keep Settings open while Dial prepares the archive. Your browser downloads a dated `dial-….rer` file. Check your downloads and move it to your private backup storage; it contains your clients' names, emails and answers.

Your browser supplies the existing secure session automatically. No cookie copying, local checkout or Cloudflare API token is needed. Development/review sessions cannot export. The same native owner owns the export job throughout; cross-origin requests and remote imports are refused.

Export briefly puts the source in maintenance after existing request and background work has drained. Requests receive 503, queues retry and the connection watch delays its next check. If writer admissions remain, export refuses with a message to wait or contact installation support. An active export holds maintenance and refuses a competing export. Settings → Export status shows a read-only count and whether an export currently holds maintenance; use **Refresh status** for a new observation. The count does not reserve or guarantee an export.

After the archive reaches your browser, Dial removes the source snapshot and releases maintenance. If preparation or downloading fails, it attempts the same cleanup and shows an error. If cleanup cannot be confirmed, or you close the page mid-export, the maintenance lease expires after five minutes; the old job cannot be downloaded or resumed. Refresh status, then start a new backup. See OPERATIONS.md for export-job cleanup and the support boundary for writer admissions that remain.

A writer admission can remain on any install, including a fresh v0.2.0 install, if the runtime kills an invocation or its final admission cleanup fails. These writer admissions do not expire and can block every subsequent hosted export; local `rer export` is unaffected. Dial cannot establish that a writer has died and provides no Clear action. Keep its admission until independently verified revocation or drain covers all old invocations and already-issued D1 and R2 effects. Pausing ingress, redeploying, waiting, or an owner confirmation does not prove this. Installation support must establish that storage guarantee before any recovery can be designed; deleting receipts without it can produce an inconsistent archive. The status endpoint remains available during maintenance, although opening a new Settings page can itself receive maintenance until the export ends.

The archive captures durable D1 records and all FILES bytes and metadata. Queue messages and coordinator alarms are execution state, not transferable authority: pending deliveries are made historical and provider checks must be re-established after restore. Privately retain the original `SESSION_SECRET`, configuration and exact source revision separately. The hosted archive imports with the ordinary local command below.

## What the archive contains

Everything durable:

- Operators, your host profile and your event types, with their questions, availability windows and date overrides.
- Bookings and every time they have been moved to, with the invitee's answers, attendance marks and the history of changes.
- Alternative requests, delivery attempts, settings and the audit trail.
- Calendar connection details and sync state, without the credentials.

Each part of the archive is checked before restore. Use the exact source revision that made the archive: unknown tables or indexes, changed migration hashes, missing entries in the migration ledger, and unfinished hosted migration claims are refused. Local Wrangler history and hosted installer history have different bookkeeping columns; those differences do not change your application schema. Restore keeps the destination’s migration ledger.

## What it leaves out

The archive never holds a secret or a live key.

- No Google access or refresh credentials, no sessions, no sign-in or invitation links, no setup or webhook secrets.
- No private manage links for bookings, and no saved email bodies that contain them.
- Not your private settings in `.dev.vars`, including your session secret.

Your Cloudflare token, SendGrid key and Google client secrets are not in the archive either. Keep them wherever you already keep them.

## Keep your session secret

Dial uses the `SESSION_SECRET` in `.dev.vars` to match retry and erasure records for bookings, and a restore refuses settings whose secret does not match the archive. Keep a private copy of `.dev.vars` with your archives, never inside the archive itself and never in git. Reset removes `.dev.vars`, so copy it first.

A hosted install keeps its `SESSION_SECRET` in `.rer/deploy/<environment>.secrets.env` in the checkout that deployed it. `rer deploy --remove` deletes that file, so copy it somewhere private before you remove an installation. To restore a hosted archive, put that `SESSION_SECRET` line in the empty destination's `.dev.vars`.

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
5. Run setup with the original owner's email and start Dial; `rer dev` prints the `RER_OPEN` link that signs you in as that owner:

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
- **Reconnect Google Calendar if it was configured.** A saved calendar connection is restored without credentials and needs reauthorization in **Settings** before event types can be published or offer times. Your chosen calendars are remembered. Fixed-link, phone and in-person events restored from a calendar-free install can offer times from their saved schedule and existing Dial bookings once mail is checked; Google Meet still requires a connected Google Calendar.
- **Check mail.** Run **Check sender** in **Settings**. Mail health is reset until you do.
- **Old manage links stop working.** Restore never recreates them. Clients can no longer use the private links from earlier emails. If a client needs to change a booking, you can reschedule or cancel it for them from **Bookings**.
- **Nothing is replayed.** Emails and calendar changes that were pending at backup time come back marked as failed, with the reason that they are historical. Restore sends no mail and touches no calendar.

Read [Calendar and email](calendar-and-email.md) for the connection steps.
