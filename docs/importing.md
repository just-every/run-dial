# Move in from saved scheduling data

Dial reads saved Calendly API responses. **Synthetic-only validation:** examples
written from public documentation have been checked; no real account export has
been supplied. Dial's Worker never receives your source token.

Run on your own computer with Node 22.20.0 and pnpm 10.12.4:

```sh
pnpm move-in:download-calendly \
  --out ./saved-schedule
```

The hidden prompt accepts your personal access token, or use the local
`CALENDLY_TOKEN` environment variable. Never put it in a command argument. Grant
read access to your user, event types, schedules, events and invitees. The fixed
origin receives GET requests only. Paging, redirects and rate-limit waits are
bounded; a failed run keeps no output. A new owner-only folder holds exact response
bytes and a manifest of hashes, sizes and capture times. Existing folders are refused.

Manual capture uses `/users/me`, `/event_types?user=...`,
`/user_availability_schedules?user=...`,
`/event_type_availability_schedules?event_type=...`,
`/scheduled_events?user=...&min_start_time=...` (active and canceled, so a later
catch-up can see cancellations and reschedules), and each event's `/invitees`,
following every `pagination.next_page` including empty pages. Create
manifest version 1 with capturedAt and files with name, resource, page, size,
sha256 and capturedAt, matching the command's format. No token, request URL or
cursor belongs in the manifest. CSV is not accepted because the reviewed public
help does not specify a complete stable export column schema.

Select manifest.json and all response files together in **Settings → Move in**.
The Overview checklist also links there. Preview writes nothing. It shows the
as-of instant captured when you upload for preview, source host, zone, per-kind accounting and every rejected, changed
or skipped item. Download its JSON report, validated against
`schemas/move-in-report.schema.json`.

| Source | Dial |
| --- | --- |
| User name, zone, slug | Creates host only if none exists; saved profile stays |
| Solo standard event | Draft title, plain description, default duration, color and visibility |
| Several duration options | Default retained; alternatives reported as dropped |
| Group, pooled, collective, ad hoc, poll | Skipped with reason |
| Text, multiline, single/multiple choice questions | Required/order retained; phone and disabled questions skipped; free other choice dropped |
| Google conferencing, address, inbound host phone, custom HTTPS | First supported location retained; additional locations reported |
| Other conferencing or custom prose | Draft requires a supported owner-chosen location |
| Associated weekly windows and overrides | Copied to event; past overrides skipped |
| Schedule zone differs | Adopt source zone for new host or skip availability; change an existing host's zone in Profile first |
| Undocumented schedule settings | Dial defaults: 15-minute increment, 240-minute notice, 60-day horizon, zero buffers, unlimited daily limit; all reported |
| Active future event, one active invitee | Confirmed Imported booking; actual occupied times, answers and source location |
| Past, canceled, multiple invitees, skipped event | Skipped and counted |
| Overlapping confirmed booking | Rejected, named and timed in host zone |

Choose a location, zone or skipped event, then preview again. The first preview upload
captures its as-of instant; selecting files alone does not capture it. Repeated
previews and choice changes use that same upload time. Selecting the files again
starts a fresh upload review and requires a fresh acknowledgment. Applying and
resuming preserve the exact reviewed instant, including its past-booking
classification. An unapplied upload review expires after 30 minutes, or when
you undo an import or sign in with a new session (including after archive
restore); select the files again to start a new review. A runtime restart with
the same signed-in session preserves the pending review. Applied jobs
resume from their saved plan without the upload or that time limit. Applying requires
acknowledgment of losses, overlaps and changes and the same reviewed fingerprint.
Continue import commits bounded batches and shows progress. Reloading lists saved
jobs; resume needs only the stored job and current operator session. Revocation
stops every mutation.

Imported events stay drafts until ordinary publication checks pass. Imported
bookings occupy time against all event types. Invitees keep their original
confirmation and calendar entry. Import sends no email, makes no calendar event
or meeting, queues no delivery and schedules no reminders. It creates an unsent
Dial manage capability with fresh cryptographic randomness for each booking.
Undo followed by a new import creates new unsent capabilities. The private
upload identity stays in browser memory and is excluded from downloaded reports
and whole-install archives. A later operator cancellation sends one ordinary
cancellation email to the invitee and leaves the source calendar entry alone.

Undo removes unchanged imported records and retains edited, published,
rescheduled, canceled, attended or noted records with reasons. Events with new
native bookings and required parents stay. With the prior import still present,
identical saved data reports “already here” and creates no duplicates. After a
full undo, the same source can be previewed and applied again as a new idempotent
import. If undo retained an edited record or required parent, preview and apply
refuse without writes or saving a new source copy; open the saved job to review
the retained conflicts.

## Catch up from a newer capture

Keep Calendly live while Dial runs beside it: invitees keep booking, canceling
and rescheduling there. After an import is applied, capture again with the same
command into a new folder and select those files in **Settings → Move in**. A
capture of the same Calendly account previews as a **catch-up**:

- Records already saved by an applied import are matched by their source identity
  and left exactly as Dial holds them, including anything you edited, published,
  rescheduled or canceled in Dial. They are never imported twice or overwritten,
  and the catch-up does not save another copy of them.
- New event types and new future single-invitee bookings get the same losses,
  overlap rejections and choices as a first import, stay drafts or arrive
  silently, and get new unsent manage capabilities. No mail, calendar event or
  reminder is created. A new booking on an event type you have opened for
  requests only is rejected with that reason, because Dial holds no bookings on
  one.
- A catch-up has its own saved job, resume and undo; undo removes only what that
  catch-up added. It keeps an extract of only the records it reviewed, not the
  full pages, which repeat people already imported.
- A capture of a different Calendly account, a capture taken while another import
  is still applying, and records kept by a retained undo are refused with a plain
  message and nothing saved.

The catch-up preview also compares every imported booking that is still in the
future with the new capture and lists one difference for each:

| Difference | What Dial does |
| --- | --- |
| Unchanged | Nothing |
| Moved at source | Shows both times in your zone. Calendly reschedules by canceling the old event and booking a new one; that new event is listed here, not imported as a second booking. Keep the Dial time, or reschedule in Bookings (the ordinary reschedule emails the invitee). |
| Canceled at source | **Release this time** cancels the Dial booking, frees its time and buffers and records you and the reason in history without emailing the invitee, because Calendly already told them. Or cancel in Bookings, which sends one ordinary cancellation email, or keep it. |
| Invitee changed | Keep the Dial booking, or change it in Bookings |
| No longer in the capture | Keep it, or cancel it in Bookings |

Nothing changes until you decide. Decisions are possible once the catch-up is
applied, and the list stays in the saved job, the downloaded report (version 2)
and a whole-install archive. Erasing a person removes their rows.

## Switch over

Once an import exists, **Settings → Switch over** (also linked from the Overview
checklist) reads from what Dial holds now:

- each imported event type's old Calendly link beside its Dial link, with its
  status (draft, published, or blocked with the exact publication reason) and a
  downloadable list for your site, signatures and email templates;
- the earliest day Calendly can be closed: the day after the last imported booking
  ends, with how many are still ahead. Until then each invitee's confirmation,
  manage link and reminders still belong to Calendly;
- unresolved differences from the latest catch-up;
- whether the Google destination calendar and the sending address that will own
  invitations and reminders for new Dial bookings pass publication's checks now;
- when the last capture was taken. Bookings made at Calendly after it are not here.

It says when every row is clear and otherwise names the open ones. Dial never
contacts or changes your Calendly account; closing it is your step.

## Cutover day

In the order an owner actually does it:

1. Keep Calendly live. Nothing below touches it.
2. Capture and preview: run the download command, select the files and read the
   report, losses and rejected overlaps.
3. Apply as drafts. Imported event types stay drafts; imported bookings hold time
   silently.
4. Publish the event types you checked, once Google Calendar and the sending
   address are connected.
5. Update your links: download the list under Switch over and replace the old
   Calendly links on your site, signatures and email templates.
6. Catch up: capture again and apply the catch-up to bring across bookings made
   since.
7. Resolve the differences: release, keep, cancel or reschedule each one.
8. Wait for the safe-to-close date shown under Switch over, catching up again if
   people still book through old links.
9. Close Calendly last.

## Erasure, archives and limits

Deleting an imported booking removes its native and retained personal copies.
All exact raw pages in affected jobs are withdrawn for privacy, since event and
invitee data may span pages. Normalized non-erased peers and job progress survive;
erased sources cannot be replayed. Erasing a person means deleting all their
bookings and requests. Whole-install exports retain imported native booking rows, native identity markers, permanent erasure guards, capture times, old scheduling links and the differences list with its decisions. Private source captures, import plans and journals are excluded because they contain source private links and replay authority. Resume and undo remain available only on the original installation; restored bookings remain marked Imported.

Per-upload limits: 8 MiB total, 600 response files plus manifest, 2,500 source
records, 100 event types and 500 scheduled events; 512 KiB per JSON document.
Dial's field limits still apply, including 25 questions, 50 choices per question
and 5–480 minute duration. Text stays inert, including markup and formulas.
Downloader requests are capped at 1,000, rate-limit retries at three and each wait
at 30 seconds. These local bounds make no hosted capacity claim.
