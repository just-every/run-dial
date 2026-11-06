# sd-dial-c-f39 results

AGENT-004 remains PARTIAL. This round closes the assigned native Google owned-duplicate-removal subpoint, building on the supplied f38 head. No whole-clause completion or release is claimed. Counts stay 90 done, 36 partial, 63 missing, total 189. No clause status, Gap, Evidence, acceptance text, homepage, UI or workflow changed.

Product branch: cloud/sd-dial-c-f39. Full candidate SHA and exact-SHA CI state are recorded in receipt.json. No PR is needed: Verify has a push entry point for this branch. The full plan is PLAN.md. Only the AGENT-004 campaign row receives this native proof update; every held queue entry and prerequisite is retained.

The existing resolver already implemented the narrowly authorized destructive operation. A remaining correctness defect was reproduced through native public booking followed by actual production delivery: after an interrupted DELETE that had not removed the extra, an external booking-marker edit could hide that active event from the filtered list. The retry marked calendar delivery succeeded. The new assertion failed on f38 runtime source, quoting: `missing marker: a hidden active extra is not completed cleanup` (exit 1, actual state `succeeded`). The fix reads the durably recorded extra ID directly before completion, accepting only its matching cancelled tombstone or an absent resource (404 or 410). An unavailable read keeps delivery pending; an active event or conflicting identity refuses completion without changing either provider event. Canonical reads still require the original ETag, and current command admission runs again after verification. Ordinary cancellation retains its original lookup.

No permanent test registration was added or removed. The existing focused public-door journey was extended. No existing assertion was removed, narrowed or hidden behind a condition. An intermediate new replay assertion mistakenly called the fixture that explicitly revives failed commands; it was corrected to replay actual Queue delivery without rewriting the outbox. This was a new test-input correction, not a CI repair.

## Scoped proof map

All rows use `tests/booking-wire.test.mjs#Google owned outage duplicates recover only for a current authorized booking and verified provider pair`, which invokes `tests/booking-wire/google-duplicate-recovery-journey.mjs` in Verify's existing test shard 11 (displayed as Tests 12 of 22). Local runtime is workerd with native public HTTP and the production delivery service; only provider HTTP is synthetic. Exact committed run and CI state are in receipt.json. The actual probe output is recovery/google-duplicate-recovery-wire.json.

| Item | Public-door proof and lines | Result |
| --- | --- | --- |
| Owned duplicate after provider response loss | Native public nonce booking, current delivery; journey lines 47–78 and 94–145 | PASS: only deterministic canonical stays active; extra removed using its ETag and no provider notice |
| Booking identity, occurrence, ICS UID, answers and manage authority | Journey lines 80–92 and 126–143 | PASS: original authority and control booking unchanged; original manage capability still reads the booked time |
| Verify both provider identities before deletion and canonical afterwards | Journey lines 102–125; resolver lines 58–86 | PASS: fresh ETag-bound reads precede deletion and exhaustive list plus direct reads precede completion |
| Lost cleanup response, retry and replay | Journey lines 109–143 and 183–208 | PASS: canonical is never patched; removed extra is verified as tombstone or 404 or 410; transient verification failure remains pending; no additional events or confirmations |
| Hidden active extra after uncertain cleanup | Journey lines 147–180 | PASS: missing or foreign booking marker cannot hide the recorded extra from direct verification; neither event changes and delivery does not complete |
| Identity, facts, pagination, extra candidates and deterministic canonical refusals | Journey lines 243–305 | PASS: all unsafe cases retain extra and canonical with no unsafe mutation |
| Fresh ETag, supersession, archive and current claim fencing | Journey lines 212–241 and 243–305; delivery repository lines 282–324 | PASS: changed facts, newer commands, lost claim and archived commands cannot complete cleanup; archive replay remains inert |
| Post-cleanup verification and ordinary cancellation controls | Journey lines 307–339 | PASS: paginated verification refuses completion; deterministic-ID 409 creates no extra event; ordinary cancellation preserves ambiguity refusal and stale upsert makes no provider request |
| Autonomous execution and continuous reconciliation | Outside assigned POINTS | HELD: not proved or changed |
| Zoom meeting recreation and one link-ready email | Outside assigned POINTS | HELD: not proved or changed |
| External-edit proposal and approved adoption with change notice | Outside assigned POINTS | HELD: not proved or changed |

## DONE-RIDERS review

No DONE claim is made. The table states the whole-clause boundary honestly.

| Rider | Result | Evidence or limit |
| --- | --- | --- |
| 1 | PARTIAL | Scoped duplicate outcome passes the named journey; autonomous, Zoom and external-edit outcomes stay held |
| 2 | PASS for scoped change | Seeded canonical and extra; safe cleanup completes and unsafe identity, fact, ETag, authority and archive cases refuse without changing the canonical or booking authority |
| 3 | PENDING | Existing Verify shard invokes the journey; exact candidate run state in receipt.json, never borrowed from another SHA |
| 4 | PASS locally | Journey re-run on committed candidate; receipt binds full SHA |
| 5 | INSPECTED | No inheritance or acceptance text changed; existing API, payment and calendar duties retained |
| 6 | PASS mechanical | Contract generator write and check pass; generated views restored from main; no Status cells or counts changed |
| 7 | PASS | No acceptance rewrite or new obligation; no ct ruling needed for this existing authorized outcome |
| 8 | PASS for scoped change | Current claimed command only; supersession, archived payload and stolen claim refused through actual delivery |
| 9 | PASS boundary | HTTP-edge synthetic provider only; no live provider or legal guarantee claimed |
| 10 | NOT APPLICABLE | No new policy default; existing owner authority and conservative refusal retained |
| 11 | PENDING LANDER | Product branch only; main equality, full-history publication scan and Run site qualification belong to the Mac lander |

## Checks and custody

Touched journey passes all 45 runtime probes. Typecheck, touched-file ESLint and the first-party check pass. Native Google and Microsoft lifecycle controls and provider runtime tests are recorded in receipt.json. Contract write and check pass with `--clauses AGENT-004`, then both generated views are restored from main. Source lock is generated last with the seed command and checked. No migration changed, so migration ledger is not applicable.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock then check exit=0; views=node scripts/contract-docs.mjs write --clauses AGENT-004 then check --clauses AGENT-004 exit=0; ledger=none exit=0.

Pre-READY self-check: scoped behavior is exercised through actual public booking and delivery, with both allowed and refused cleanup. Existing assertions retained. Revoked-token handling remains explicitly held; archive and stale-command replay do not resurrect authority. No screen touched, so browser proof and tooltip rules are inapplicable. Source lock is fresh. No added email-shaped string or bare prose slash token was found. Exact-SHA Verify, publication scan, main equality and Run site are not claimed locally complete; final states are recorded below and in receipt.json.

f38 Verify 42246662008 on 3cb5efe115c55fd1ed14b411ba22e8e30cb40502 failed job 127990609290, Tests 3 of 22, because the local dev runtime did not start within its timeout. Its exact command `CI=true node scripts/ci-verify.mjs test 2` was run before product editing on that head under Node 22.20.0. The reported dev-identity test passed locally. The shard exited 1 because this cloud lacks Playwright's bundled Chromium; that different local browser failure was not treated as a product defect and no test or workflow was changed. Full reproduction details are in ci-reproduction.json. No CI repair round was attempted. Route the known dev-server start timeout to fv; no rerun was dispatched here.

Main inspected at 7416c12f5ecf1807453a6f41a22bac849adb4068: Verify 42235457149 and 42232968849 succeeded; Run site 42235457024 succeeded. The candidate has not landed and does not equal main. Publication scan: commit=candidate (see receipt.json), complete=not-run-in-cloud, historyScanned=not-established, findings=not-established. The guarded fleet lander must supply its exact-tree COMPLETE scan and exact-SHA green workflows before landing.

GAP AGENT-004: Autonomous and continuous reconciliation with AGENT-001 grants, approvals, pause and ADMIN-002 audit integration, held UI qualification, Zoom recreation and link-ready mail, external-edit proposals and approved adoption, broader attendee, conference, account and host drift, revoked-token and lapsed-subscription handling remain unproved and unchanged. Existing API and payment custody, CAL-010 and CAL-011 custody, MEET-002 and CAL-012 prerequisites and all release holds remain in force.

No changes to EVENT-007 then EVENT-010 then OPER-001 and TEAM-001 ordering, API-001 continued-3x hold, AUTH-008 owner-only consent floor, DATA-002 NO ruling, DATA-004 hold, f26 custody or any other queue entry. No unrelated clause was started. Evidence is published separately from the product ref.

Candidate: b571279e853fa019a40b18564c6a88bdcbab7f21 on cloud/sd-dial-c-f39; product push succeeded on attempt 1. Latest main was already an ancestor, so integration changed no byte or commit. Provider runtime tests: 7 passed. Ordinary provider lifecycle and correspondence registrations: 2 passed. Exact candidate CI discovery: [{"conclusion": null, "event": "push", "head_sha": "b571279e853fa019a40b18564c6a88bdcbab7f21", "html_url": "https://github.com/just-every/run-dial/actions/runs/42253160826", "id": 42253160826, "name": "Verify", "status": "in_progress"}]. No green candidate CI or landing is claimed.

Exact committed proof: b571279e853fa019a40b18564c6a88bdcbab7f21 passed the focused native journey (1 registration, 45 public-door probes, 31.7 seconds). The committed checkout stayed clean. Typecheck and all other touched checks ran on byte-identical runtime and journey files; the later source lock generation and no-op rebase changed no tested code.

CLAIM AGENT-004 PARTIAL points=1 tests=tests/booking-wire.test.mjs#Google owned outage duplicates recover only for a current authorized booking and verified provider pair

Point 1 means only the first duplicate-removal acceptance outcome. Zoom and external-edit adoption are not counted; autonomous reconciliation and every held boundary remain unproved.
