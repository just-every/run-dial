# Releasing Dial

The public source repository is `just-every/run-dial` (`https://github.com/just-every/run-dial`). The current version is 0.4.2, declared consistently by package, seed and release metadata. Releases are annotated tags `vVERSION` created by `rer release --tag` from a green main commit, which also writes the producer bundle; the first release was `v0.1.0`. Live Google Calendar and Meet acceptance on a real account is not yet proven; see HANDOVER.md and ACCEPTANCE.md.

Before a release, freeze and independently verify the candidate, refresh and check its complete source lock, review migration/update instructions, and run Base's publication checks against the exact intended public tree. Keep private authoring history and historical evidence private. The actual parentless export must have a complete history scan with zero findings, source bytes and modes that match exactly, and an exact clean-clone verify receipt. A no-tag dry-run must record DRY_RUN, no created/pushed tag and publicExport null. No preparation claim substitutes for these receipts.

Publish or tag only through the authorized release procedure after review. A source publication check is distinct from whole-product, live-provider, deployment and accessibility/capacity acceptance; preserve the limitations in HANDOVER.md and ACCEPTANCE.md in any public announcement.

Calendar-optional scheduling uses saved availability and persisted booking occupancy for fixed locations. Publishing explicitly enables real bookings; setup and the publication controls disclose that external calendar conflicts are not checked without a connected calendar. No separate opt-in preference or migration is needed for this notice. Connected calendar failures still close booking; Google Meet still needs Google. Apply additive migration `0042_optional_calendar.sql` after backing up. It preserves existing provider obligations and records new schedule-only bookings without claiming calendar delivery. The cold-host acceptance journey covers booking and independent contention at 1440px and 390px.

Hosted export now uses the native owner session and published Base HTTP
portability primitives. Migration `0043_hosted_portability.sql` adds source
admission receipts and an expiring maintenance lease, excluded from archives.
Run `rer export --target remote` from a stopped local checkout with the source
origin and a private native-cookie file. Preserve the original SESSION_SECRET
separately and rehearse ordinary import into a fresh empty local installation.
Remote restore remains unavailable. See `docs/backups.md` and `OPERATIONS.md`
for source maintenance, interrupted-job cleanup and crashed-writer recovery.
