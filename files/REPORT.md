# sd-dial-c-f41 results

Repository: https://github.com/just-every/run-dial
Branch: `cloud/sd-dial-c-f41`
Candidate: `1b1a7a23cc0db79febd39132a2b64c097a373459`
Baseline main: `b571279e853fa019a40b18564c6a88bdcbab7f21`
PR: none required; Verify has a push entry point for this branch.

EMBED-001 remains PARTIAL. This round implements only the authorized floating-popup booking and BOOK-013 parent-redirect subpoint for an ordinary single-host, free, unapproved fixed-location event with no guests or connected calendar. The broader clause is not complete. Counts before and after: 90 done, 36 partial, 63 missing, 189 total. No contract status, gap, evidence, acceptance text or plan queue entry changed.

## Implementation

The served script accepts popup mode and creates one floating text launcher per event and script origin. Opening it mounts the existing production booking iframe in a native modal dialog. Closing removes the managed frame, restores page overflow and returns focus to the launcher. Duplicate script loads do not duplicate the launcher. A page-wide non-capability reference set preserves once-only booked dispatch and redirect behavior.

Real browser development found two defects and drove their fixes: Escape in a cross-origin iframe does not reach a native parent dialog, and queued close events can race an immediate reopen. A focused child keyboard helper decorates only already-authorized embed documents with the existing served script. The parent accepts close messages only from its script origin and its active managed popup frame. Cleanup runs synchronously and idempotently; older close events cannot remove a newly open frame.

The embed routes only decorate successful authorized documents and allowed recovery documents; authorization predicates and blocked responses remain unchanged. Existing booking, manage, Settings, authorization policy and held UI implementations remain read-only. Existing inline and modal mounting meanings, bounded prefill and UTM projection, HTTPS redirect validation and frame authority are preserved. No migration, provider integration, new persisted data, owner configuration UI or homepage change was introduced.

## Exact candidate verification

`CHECKS.json` is the authoritative exact-head local command receipt. All nine checks listed there returned exit 0. It includes the production build, deployment specification check, typecheck, focused lint, both touched test files, first-party check, boundary check, contract-view check and source-lock check. Browser commands use the dedicated cloud subreaper and a 1,200-second timeout. Chromium runs headlessly with no sandbox. No full local suite or workflow file was changed.

push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted

The baseline main had successful push Verify 42266157020 and Run site 42266156970 on its exact SHA. Those are baseline evidence only. Candidate main equality, candidate Run site and the complete publication scan belong to the Mac lander and are not claimed here. Full Git history is present in the product clone.

Publication scan: commit=1b1a7a23cc0db79febd39132a2b64c097a373459 complete=unestablished historyScanned=unestablished findings=unestablished. Cloud-side scanning was not run under the supplied cloud protocol. No COMPLETE or zero-findings claim is made.

## Acceptance sentence and scoped outcomes

EMBED-001 has one composite acceptance sentence. It requires builder-specific popup-widget, popup-text and inline booking, rescheduling and cancellation; exactly-once parent lifecycle events; cookie absence; and popup redirect ordering. This round proves the assigned booking and redirect subpoint, not that entire sentence, so the formal claim uses points=none.

| Row | Outcome | Public-door proof on this candidate | Result and CI |
| --- | --- | --- | --- |
| A1 | Full EMBED-001 composite acceptance sentence | Assigned subset below; held lifecycle and builder combinations remain unperformed | PARTIAL; push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| R1 | Served script creates a floating launcher and books through the real iframe | `tests/embed-popup.test.mjs` named journey; `tests/embed-popup/journey.mjs` lines 66, 129 and 175; native confirmation 201 and exactly one native booking and occurrence | Local PASS; push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| R2 | BOOK-013 parent HTTPS navigation occurs once after committed booking and capability-free booked event | Journey lines 54, 138 and 146: exact order committed, booked, navigation; selected event, start, name, UTM and non-capability reference only; no nonce or manage capability | Local PASS; push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| R3 | Redirect off shows the ordinary receipt without navigation | Journey line 159: confirmation heading and manage action in iframe, parent URL unchanged, zero navigation | Local PASS; push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| R4 | Confirmation, receipt and message replay do not duplicate booking, booked event or navigation; repeated mounting is safe | Journey lines 80, 93, 142 and 163: duplicate script, rapid close and reopen, native replay 200, reloaded receipt and replayed messages; one reference event and native booking | Local PASS; push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| R5 | Foreign origin and unmanaged frame messages are refused; disallowed parent gets no booking projection | Journey lines 28 and 109: actual unallowlisted parent 404 with framing denied and no write; foreign parent and same-source sibling booked and close messages have no effect | Local PASS; push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| R6 | Booking iframe sets no third-party cookies | Journey lines 54 and 182: network Set-Cookie refusal observation and empty browser cookie jar, including receipt reload | Local PASS; push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| R7 | Keyboard open, close, frame-focused Escape, modal focus containment and focus return | Journey lines 71 through 98; native button and dialog through the real cross-origin frame | Local PASS; push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| R8 | Responsive changed screens, bounded horizontal overflow and axe | Journey scan at line 13, desktop full assertion flow and phone booking smoke; seven screenshots at 1440 and 390; no serious or critical axe findings and no horizontal overflow | Local PASS; push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| D1 | Inherited BOOK-013 safe committed redirect semantics | Same R2 and R3 proof; existing redirect rendering is unchanged. `tests/embed-document-authorization.test.mjs` also retains non-HTTPS, credentialed and malformed redirect refusal and foreign-frame checks | PASS for assigned subpoint; push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| D2 | LINK-003 prefill and UTM preservation | Journey lines 131 and 153 assert actual prefilled name and address and selected UTM projection; original bounded answer and UTM forwarding remains unchanged | PASS for assigned subpoint; push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| D3 | Parent analytics event carries no booking capability | Journey line 174 checks exact event detail containing only the non-capability booking reference | Local PASS; push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |

Test name: `floating popup books once through a separate parent and redirects only after its safe booked event`.

The existing six-test authorization file remains byte-for-byte unchanged and still exercises denied documents and loaders, malformed parents, unknown paths, unpublished events, valid projections, redirects, manage reschedule, expiry and cancellation. One new integration registration was added. No existing assertion was removed, narrowed, skipped or moved behind a width condition. Comprehensive new assertions run at desktop; phone is the required booking and screen smoke.

## DONE-RIDERS review

This is a PARTIAL claim, not a request to count the clause DONE.

| Rider | Result | Evidence |
| --- | --- | --- |
| 1 | PARTIAL for whole clause; assigned outcomes PASS | A1 remains open; R1 to R8 name executed user outcomes. push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| 2 | PASS for assigned scope | Actual D1 booking and occurrence increments, native replay and real refused parent and frame paths; journey lines 28, 109, 142 and 175. push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| 3 | PENDING: the original assertions also fail on main; the permitted rerun is requested, with no green result observed | Root test is automatically discovered by existing push Verify test partitions; browser-needed follows its imports. push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| 4 | PASS | Exact-head checks and screenshots are bound by CHECKS.json and PROVENANCE.json; no relevant source or test changes follow them. push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| 5 | PASS, inspected | Existing EMBED-001 explicitly names BOOK-013, LINK-003 and INTEG-006. No new Base inheritance is claimed. push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| 6 | PASS, mechanical | Contract write and check passed; generated views restored from main; source lock regenerated last and checked. Contract status cells and counts are untouched. push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| 7 | PASS, inspected | No acceptance text, ruling, ID map or coverage rewrite. push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| 8 | PASS for relevant frame authority | Authorized booking succeeds; forbidden parent and foreign or unmanaged sender paths are actually exercised and change nothing. No operator permission implementation changed. push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| 9 | PASS, honest boundary | No live-provider, builder-platform installation, legal, payment or calendar claim; the supported event has no calendar connection. push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| 10 | N/A | No new custody, consent, spending or authority policy default was adopted. Existing exact origin and managed frame restrictions remain. push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |
| 11 | PENDING GUARDED LANDING | Candidate is branch-only. Main equality, complete full-history publication scan, exact resulting Verify and Run site remain with the lander. push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted |

## Pre-handoff self-check

1. Each assigned user-visible outcome has real public-door proof; whole-clause held outcomes remain explicitly unclaimed. push Verify 42534917583 attempt 1 failed on this exact SHA; both original failures also reproduce on baseline main; one permitted failed-job rerun was accepted (HTTP 201) at 2026-11-09T00:09:36Z; rerun conclusion is unobserved because the ten-call repository API budget is exhausted
2. Existing assertions are unchanged. No product test was deleted or weakened.
3. Replay and frame authority paths are exercised both ways. No new authority, stored identity or erasure carrier was added; existing booking and manage authority remains covered by the unchanged authorization suite and normal Verify.
4. New launcher and close controls have visible text at 16 and 14 pixels. There are no new icon-only controls. New rounded controls use full borders. No configuration was added outside Settings. Desktop and phone screenshots were visually inspected; overflow and serious or critical axe checks pass.
5. Local mechanical checks and source lock pass. Publication scanning, main equality and candidate Run site remain guarded lander obligations, not builder-established results.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock then check exit=0; views=node scripts/contract-docs.mjs write --clauses EMBED-001 then check --clauses EMBED-001, followed by restoring ACCEPTANCE.md and docs/CLAIMS.md from origin/main exit=0; ledger=none exit=0.

PROBE EMBED-001 popup: separate allowed parent loads served script, opens popup and selects a future native slot -> real iframe confirms one booking and one capability-free booked event; repeated mounts and replay preserve one result; denied parent and foreign frames are refused.
PROBE BOOK-013 parent redirect subpoint: configured HTTPS destination with selected event, start, name, UTM and reference -> committed response precedes one booked event and exactly one parent navigation; redirect off leaves the ordinary receipt and zero navigation.

## Held scope and campaign return

GAP EMBED-001: Operator copy and configuration controls; popup-text and inline full lifecycle qualification; date-selected, rescheduled and canceled parent events; complete builder-specific exactly-once journeys; WordPress, Squarespace, Wix, Webflow, Shopify and Pane installation coverage; height, color and host-detail controls; broader paid, approval, guest, group, team and provider combinations remain held.

The campaign row update is this floating-popup booking and parent-redirect subpoint only, PARTIAL to PARTIAL with unchanged counts. Preserve held UI custody, all queue entries, notes and holds, API, payment and calendar custody, CAL-010 and CAL-011 custody, MEET-002 and CAL-012 prerequisites, EVENT-007 then EVENT-010 then OPER-001 and TEAM-001 order, API-001 continued-three-times hold, AUTH-008 owner-only floor, DATA-002 NO, DATA-004 plan hold, sd-dial-c-f26 gate and landing, and every release prerequisite. No whole-clause completion or release is authorized or claimed.

The assigned subpoint passes local checks. Full Verify qualification is held by the failed assertions documented below. Broader held scope remains as above. No publication, acceptance or landing is inferred from report transport.

CLAIM EMBED-001 PARTIAL points=none tests=tests/embed-popup.test.mjs#floating popup books once through a separate parent and redirects only after its safe booked event


## Completed-run diagnosis

Verify 42534917583 attempt 1 failed in Tests 3 of 22, job 128897005875, and Tests 19 of 22, job 128897005940. The final aggregate job 128900516318 failed because partitions were red. Each assertion job archive was read exactly once with the prescribed `gh run view` command. URL queries, capability paths and the CI environment header are omitted from published logs.

The isolated exact-candidate command `node scripts/ci-verify.mjs test 2` returned exit 1 with the same payment-screen bootstrap `409 !== 303` in the PAY-001 and PAY-003/PAY-006 journeys. It also hit the cloud dev-runtime startup wait. The first concurrent local attempt is retained only as a diagnostic because the partitions share a fixed browser-fixture listener.

The exact-candidate command `node scripts/ci-verify.mjs test 18` returned exit 1 with `setup owner is protected until ownership transfer: 403 !== 409`. Running that same failing native operator test on baseline main b571279e853fa019a40b18564c6a88bdcbab7f21 on this VM also returned exit 1 with the same assertion. This establishes a pre-existing main failure for that assertion under the supplied RED VERIFY rule.

The payment comparison uses baseline main's application and test source with the identical failed file set selected by the unchanged CI runner. The same failed file set on baseline main returned exit 1, reproducing both payment-screen bootstrap errors, 409 !== 303. MAIN-shard-2.json and its log contain the actual command and result. The cloud dev-runtime startup wait also occurred in both runs.

No payment or authorization implementation, test assertion, landing guard or workflow has been changed to repair these failures. Under the supplied RED VERIFY rule, both original assertion failures are pre-existing main failures and are reported to fv without a source repair. The one permitted failed-job rerun was accepted with HTTP 201 at 2026-11-09T00:09:36Z. All ten repository API calls are used; no rerun conclusion or green Verify is claimed. The terminal custody is PUSHED, with qualification left to the guarded lander.

VERIFY_REPRODUCED {"head":"1b1a7a23cc0db79febd39132a2b64c097a373459","job":128897005875,"command":"node scripts/ci-verify.mjs test 2","test":"PAY-001 a paid booking confirms only after Stripe's signed event; PAY-003 and PAY-006 accounting journey","exit":1,"failure":"payment screen bootstrap: 409 !== 303"}
VERIFY_REPRODUCED {"head":"1b1a7a23cc0db79febd39132a2b64c097a373459","job":128897005940,"command":"node scripts/ci-verify.mjs test 18","test":"native destructive management preserves authorship and protects self and setup owner","exit":1,"failure":"setup owner is protected until ownership transfer: 403 !== 409"}


## Terminal product custody

PUSHED branch=cloud/sd-dial-c-f41 head=1b1a7a23cc0db79febd39132a2b64c097a373459

No READY, main landing or release is claimed. The source remains at the exact locally proven and pushed SHA. Full Verify attempt 1 was red; the allowed rerun was requested once after main comparisons and is unobserved here. The shared failure details are passed to fv and sd. The complete packet is published through the separate evidence ref, which conveys reports only.
