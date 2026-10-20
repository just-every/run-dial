# Implemented contract claims

PAY-001 is done on the native single-host surface: a host connects their own Stripe account by Connect Standard OAuth (signed, session-bound, single-use ten-minute state), sets a USD price or a price per duration, and the invitee pays through Stripe Checkout while the slot is held for ten minutes through the BOOK-002 claim. The booking confirms only on Stripe's signed event; the return URL, duplicates, bad signatures and foreign accounts confirm nothing. Receipt, manage page, mail and the operator record show the amount and Stripe reference; cancel and reschedule keep the payment and say Dial issues no refund. A Stripe test-mode run paid test card 4242 on Stripe's hosted page against a Checkout Session Dial created, and delivered the real signed event to Dial; Stripe-to-Dial delivery to a deployed Worker and a real Connect OAuth grant are not claimed. Refunds and deposits, packages and coupons, tax and invoices, and reconciliation remain PAY-003, PAY-004, PAY-005 and PAY-006.

Evidence: `tests/payments-wire.test.mjs`, `tests/booking-wire/payment-journey.mjs`, `tests/export-base-adoption.test.mjs`, migration `0068_stripe_payments.sql`, screenshots and `stripe-test-mode.json` in `evidence/contract/2026-10-21/PAY-001/`.

AVAIL-012 is done on the native single-host surface: locked location time and the invitee browser observation stay distinct from request submission through booking, confirmation, manage, export and restore. Operator-created bookings without an invitee observation explicitly say “Zone not provided by invitee.” Existing SMS and workflow-variable obligations remain inherited by FLOW-002 and FLOW-001.

Evidence: `tests/booking-wire/booking-policy-journey.mjs`, `tests/export-base-adoption.test.mjs`, `tests/archive-prior-release.test.mjs`, migration `0067_request_browser_timezone.sql` and screenshots in `evidence/contract/2026-10-21/AVAIL-012/`.

The contract census is 81 done / 19 partial / 70 missing (170 clauses). DATA-004 remains partial. Other claims and their evidence remain in the CONTRACT.md Status table.
