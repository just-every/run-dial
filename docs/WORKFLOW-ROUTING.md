# Routing host email workflows

An owner-issued credential with `workflows:manage` and `routing:manage` can create a workflow at `/api/v1/workflows` with `trigger` set to `routing-without-booking`, `action` set to `email-hosts`, and `routingFormId` set to its own form. The event type and routing form must both be within the credential's grant. Set `enabled` explicitly to `true` to authorize future submissions.

A disqualifying message outcome queues one email to the routing form's owning host, while that host is an active owner. It never notifies unrelated workspace owners. The subject and text are literal host-authored content; booking variables, private answers and management links are unavailable. The notice adds the submission reference and states that no booking was made. Routing answers cannot supply an email recipient or authorize a CRM contact.

Repeated submissions using the same API idempotency key and repeated scheduler or delivery passes send one notice. GET `/api/v1/workflows/:id/runs` returns its submission reference and sent, skipped or failed outcome. Pausing, changing or removing the workflow invalidates unsent captures. Re-enabling the workflow cannot replay a capture. Delivery rechecks the enabling owner, current form ownership and recipient access before invoking the ordinary mail provider.

Routing email execution receipts remain installation-local. Archive restore disables workflow definitions and cannot resume those effects. Source removal deletes its queued mail. Operator erasure removes authored workflow captures and their mail through the ordinary erasure graph.

The conservative owner-only authorization policy remains the interim floor. Invitee email, routing CRM effects and SMS require their own supported identity, consent and transport boundaries; this action does not infer consent from a routing answer. RER Managed SMS still needs a service contract from Base. Full CRM meeting handoffs and provider coverage remain owed by the integration clauses in CONTRACT.md.
