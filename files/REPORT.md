# sd-dial-c-f37 plan and results

Repository: just-every/run-dial
Branch: cloud/sd-dial-c-f37
Starting main: 7416c12f5ecf1807453a6f41a22bac849adb4068
Predecessor fe1c5e3fab2169796cfe2425173917a9eb123ee3 is already an ancestor of main; no replay is needed.
Counts before: 90 done, 36 partial, 63 missing. AGENT-004 remains PARTIAL; only the assigned owned Google duplicate recovery subpoint is in scope.

Plan:
1. Map the existing public-door journey and provider recovery to the assigned subpoint, preserving the landed predecessor and every held boundary.
2. Reproduce the lost cleanup response defect through native public booking and production delivery. Extend the existing journey rather than adding a test registration.
3. Fix the current-command recovery so that a matching sole canonical event is verified without another provider invitation. Keep unrelated booking combinations on their existing path and refuse ambiguous provider state or stale authority.
4. Prove both recovery outcomes, unsafe refusals, deterministic conflict and cancellation controls; run touched tests, types, lint, first-party validation, contract generation and source lock checks.
5. Commit and push saves with the fleet identity; merge fresh main before the final candidate. Discover exact-head Verify through REST, publish the actual non-secret packet separately, and hand off to the guarded lander.

Baseline reproduction: Node 22.20.0, exit 1. Existing public-door journey plus the new assertion failed with: "a lost cleanup response recovers by reading provider state without sending another invitation". The retry emitted a canonical PATCH with sendUpdates=all after the extra event was already deleted. Full sanitized output is baseline-reproduction.txt.

Full-clause gaps remain: autonomous continuous reconciliation and grants, approval and pause, audit integration, held UI, Zoom recreation and its link-ready mail, external-edit proposals and approved adoption, broader attendee, conference, account and host drift, revoked tokens and lapsed subscriptions. No whole-clause DONE or release is claimed. No policy default is introduced.

Implementation results:
- The original pair recovery remains restricted to exactly two complete active Google events, matching all four ownership markers and intended facts, fresh ETag reads, conditional removal of only the extra event, then provider verification.
- A matching singleton left by a committed cleanup is verified through a complete list and conditional canonical read; it is never patched or re-invited for the same current command.
- Admission distinguishes an unsupported booking combination from a stale command. Unsupported combinations retain their existing upsert behavior; superseded, archived and reclaimed commands in the supported scope refuse recovery.
- Existing assertions and test registrations are retained. The current journey gains lost-response no-write assertions and stale-command probes before listing and during canonical verification. No UI, schema, workflow, contract status, generated view, dependency pin or held feature is changed.

Local runtime note: one attempted overlap with the calendar regression run failed with ERR_ADDRESS_IN_USE on the shared fixture port 15754, exit 1. This local orchestration error is recorded in local-port-conflict.txt; the final recovery run is serialized. No CI repair or test weakening was made.

Starting-main CI: Verify push runs 42235457149 and 42232968849 completed success on 7416c12f5ecf1807453a6f41a22bac849adb4068. Run site 42235457024 completed success on that same main SHA. The first short-SHA discovery returned no runs; the full-SHA discovery supplied these records. GitHub calls used so far: 2.

Acceptance and inherited-duty proof map (whole-clause completion is excluded):

| Item | Result in this round | Public-door proof |
| --- | --- | --- |
| AGENT-004 first acceptance subpoint: remove an owned outage duplicate and verify the provider result | Implemented, PASS on exact-head local run; branch Verify is running as recorded in the receipt | ./tests/booking-wire.test.mjs, Google owned outage duplicates recover only for a current authorized booking and verified provider pair; ./tests/booking-wire/google-duplicate-recovery-journey.mjs lines 94 to 171 and 174 to 271 |
| AGENT-004 second acceptance subpoint: missing Zoom meeting and one link-ready email | HELD, unproved | No Zoom recreation or mail work is authorized |
| AGENT-004 third acceptance subpoint: external-time proposal and approved adoption | HELD, unproved | No external-edit adoption work is authorized |
| Continuous autonomous execution under AGENT-001 grants, approvals and pause | HELD, unproved | Existing prerequisite remains unchanged |
| ADMIN-002 audit integration | HELD, unproved | Existing prerequisite remains unchanged |
| CAL-004 canonical identity and delivery replay | Retained; native regression and focused recovery journey | Same focused journey retains deterministic-ID conflict and public nonce replay; existing native calendar lifecycle journey retained |
| CAL-008 external-sync conflict boundary | Retained; no source changes in sync or conflict code | Existing native calendar lifecycle journey, provider HTTP fixtures |
| CAL-010, CAL-011, MEET-002 and CAL-012 custody and prerequisites | HELD and unchanged | No provider expansion in this round |

DONE-RIDERS check, assessed without claiming whole-clause DONE:

| Row | Result | Evidence or remaining condition |
| --- | --- | --- |
| 1 | FAIL for the whole clause; PASS locally for the assigned subpoint | Named native recovery journey performs cleanup, provider verification, loss recovery, refusals and replay. Zoom and adoption outcomes remain held |
| 2 | PASS for this slice | Recovery journey lines 94 to 171 and 174 to 271 exercise supported cleanup and unsafe identity, fact, ETag and command refusals with unchanged authority and controls |
| 3 | PENDING exact-head CI | Focused journey is unconditionally registered in ./tests/booking-wire.test.mjs line 96 and discovered by the existing push Verify; final run ID and state are recorded separately |
| 4 | PASS local proof binding | Final receipt records candidate head and source hashes; no relevant source change after final proof |
| 5 | INSPECTED, unchanged | No new inheritance or receiving acceptance text; autonomous duties remain held |
| 6 | PASS mechanically | Generator write and check pass; generated views restored from main; no contract source, status or count change |
| 7 | PASS | No acceptance text changed, no ruling or coverage rewrite needed |
| 8 | PASS for scoped authority | Native supported cleanup and superseded, archived and reclaimed-command refusals, before listing and during canonical verification; original manage authority retained |
| 9 | PASS as an honest boundary | Google and mail are synthetic at the HTTP edge; no live-provider claim |
| 10 | NOT APPLICABLE | No new policy default; existing native command authority and conservative scope retained |
| 11 | PENDING guarded landing | Main equality, full-history publication scan, exact-head Verify and resulting Run site remain the lander's gates |

Pre-READY self-check:
1. Scoped behavior is demonstrated by native booking and production delivery, including the new no-provider-rewrite assertion which failed on the baseline. Whole-clause UI and autonomous behavior remain held.
2. No existing assertion is removed, narrowed, skipped or put behind a condition. Existing deterministic-ID conflict, lost-upsert response and lost-cleanup response assertions remain.
3. Scope-relevant replay and archive authority are exercised; no erasure, token custody or other provider path is changed. Broader revoked-token behavior remains held.
4. No screen or browser qualification is in scope and no UI file is touched.
5. Local checks are recorded in the receipt. Publication scan and landing are not available in this cloud. Scan result: commit=8b0da35380662df3fda363534a1dbdb91338bb28, complete=not established, historyScanned=not established, findings=not established. No COMPLETE or zero-findings claim is made. Candidate main equality and Run site remain unestablished until guarded landing.

Plan row change to relay: AGENT-004 remains PARTIAL to PARTIAL, with the owned Google duplicate subpoint additionally proving that loss of the cleanup response cannot rewrite the canonical event or send another provider invitation. Counts after remain 90 done, 36 partial, 63 missing. All held scope, queue order, API hold, owner consent floor, data rulings, f26 custody and release prerequisites are retained.

Terminal product custody:
- Candidate: 8b0da35380662df3fda363534a1dbdb91338bb28, branch cloud/sd-dial-c-f37, pushed and confirmed by the remote ref. No PR is needed because branch pushes are the native Verify entry point.
- Main remains 7416c12f5ecf1807453a6f41a22bac849adb4068. The predecessor is already included, and both pre-candidate fetch and merge operations reported Already up to date. No main push, rebase or force push was made.
- Exact-head local focused journey passed: 1 test, 33 public-door probes, 0 failures. The three related native regression tests passed. Typecheck, touched lint, build, deployment-spec check, first-party check, contract generation and source lock checks pass. Four test registrations ran; no registrations were added or removed.
- Branch Verify 42240250935, event push, is in_progress on 8b0da35380662df3fda363534a1dbdb91338bb28; no green candidate CI or landing is claimed. Starting-main Verify and Run site are green as recorded above. No rerun or workflow dispatch was requested. Three GitHub REST calls were used, with no polling inside 300 seconds.
- All two product candidate commits have the fleet author and committer and no trailers. The active cleanup hook preserved repository hooks. CONTRACT.md and both generated view files are unchanged from main. The final source lock was generated after all edits and main synchronization and checked again on the candidate.
- Scan result: commit=8b0da35380662df3fda363534a1dbdb91338bb28; complete=not established; historyScanned=not established; findings=not established. Publication scan, candidate Verify completion, main equality and resulting Run site are the guarded lander's work.
- No blocker in the assigned slice. The full clause stays PARTIAL because its explicitly held outcomes remain outside this assignment.

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock then check exit=0; views=node scripts/contract-docs.mjs write --clauses AGENT-004 then check exit=0; ledger=none exit=0

CLAIM AGENT-004 PARTIAL points=1 tests=tests/booking-wire.test.mjs#Google owned outage duplicates recover only for a current authorized booking and verified provider pair
GAP AGENT-004: Continuous autonomous grants, approvals, pause and audit, held UI, Zoom recreation and link-ready mail, external-edit proposals and approved adoption, broader provider drift, revoked tokens and lapsed subscriptions remain held and unproved.

Actual runtime probes:
PROBE AGENT-004 owned duplicate: native booking and current delivery -> extra removed, canonical verified, original authority retained and replay inert
PROBE AGENT-004 owned duplicate with cleanup response loss: native booking and current delivery -> extra removed, canonical verified, original authority retained and replay inert
PROBE AGENT-004 cleanup response loss and facts: native delivery retry -> refused without canonical writes or authority changes
PROBE AGENT-004 cleanup response loss and supersede: native delivery retry -> refused without canonical writes or authority changes
PROBE AGENT-004 cleanup response loss and archive: native delivery retry -> refused without canonical writes or authority changes
PROBE AGENT-004 cleanup response loss and claim: native delivery retry -> refused without canonical writes or authority changes
PROBE AGENT-004 cleanup response loss and pagination: native delivery retry -> refused without canonical writes or authority changes
PROBE AGENT-004 cleanup response loss and supersede-before-list: native delivery retry -> refused without canonical writes or authority changes
PROBE AGENT-004 cleanup response loss and archive-before-list: native delivery retry -> refused without canonical writes or authority changes
PROBE AGENT-004 cleanup response loss and claim-before-list: native delivery retry -> refused without canonical writes or authority changes
PROBE AGENT-004 occurrence marker: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 command marker: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 UID marker: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 missing identity: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 changed title: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 changed canonical facts: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 changed description: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 changed location: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 changed time: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 changed attendee: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 conference: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 missing ETag: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 extra candidate: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 pagination: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 missing deterministic canonical: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 fresh changed facts: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 delete ETag conflict: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 superseded command: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 archived command: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 reclaimed command: native delivery recovery -> refused, canonical and booking authority unchanged
PROBE AGENT-004 provider verification: cleanup followed by paginated verification -> delivery not completed
PROBE AGENT-004 deterministic conflict: hidden canonical produces 409; retry retains the original provider ID
PROBE AGENT-004 cancellation and stale upsert: native cancellation keeps ambiguous pair lookup; stale original upsert makes no provider request
