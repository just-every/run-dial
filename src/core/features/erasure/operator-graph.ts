import { defineErasure, rateEdges, type Edge } from "../../../modules/erasure/index.mjs";

/** A retained native author is reached through a short-lived semantic root. Its
 * deletion uses the maintained journal to advance the old-archive epoch without
 * tombstoning the anonymous author row that a later archive must preserve. */
export function operatorGraph(retainNative: boolean) {
  const root = retainNative ? "operator_erasure_subjects" : "oa_operators";
  const email = retainNative ? "(SELECT email FROM oa_operators WHERE id=?)" : "?";
  const recipient = retainNative ? "id" : "email";
  const edges: Edge[] = [
    ...["api_credentials", "api_oauth_applications", "oa_sessions", "oa_tokens", "oa_credentials", "oa_owner_signins", "oa_step_up_challenges", "oa_external_identities", "oa_invitation_cancellations", "calendar_oauth_states", "accounting_oauth_states", "notice_oauth_states", "oc_owner_claims", "operator_sessions", "magic_link_tokens", "operator_delivery_preferences", "operator_creation_receipts", "operator_creation_tombstones"].map(table => ({ table, from: root, on: { operator_id: "id" } })),
    { table: "api_request_keys", from: "api_credentials", on: { credential_id: "id" } },
    { table: "api_rate_windows", from: "api_credentials", on: { credential_id: "id" } },
    { table: "api_credentials", from: "api_oauth_applications", on: { oauth_application_id: "id" } },
    { table: "oa_tokens", from: root, on: { issuer_id: "id" } },
    { table: "oa_auth_audit", from: root, on: { actor_id: "id" } },
    { table: "oa_setup_links", from: root, on: { owner_id: "id" } },
    ...["oa_provider_sessions", "oa_provider_session_pins"].map(table => ({ table, from: "oa_sessions", on: { session_id: "id" } })),
    { table: "oa_step_up_challenges", from: "oa_sessions", on: { session_id: "id" } },
    { table: "oa_dev_credentials", from: "oa_tokens", where: "credential='oa_tokens' AND id=?", params: ["id"] },
    { table: "oa_dev_credentials", from: "oa_sessions", where: "credential='oa_sessions' AND id=?", params: ["id"] },
    { table: "base_mail_dispatch", from: "oa_tokens", on: { delivery_id: "id" } },
    { table: "base_mail_dispatch", from: "oa_step_up_challenges", on: { delivery_id: "id" } },
    { table: "rer_mail_development_outbox", from: "oa_step_up_challenges", where: "json_extract(message,'$.deliveryId')=?", params: ["id"] },
    { table: "delivery_outbox", from: root, where: `json_extract(payload_json,'$.to')=${email}`, params: [recipient] },
    { table: "delivery_attempts", from: "delivery_outbox", on: { outbox_id: "id" } },
    { table: "operator_mail_invocations", from: "delivery_outbox", on: { outbox_id: "id" } },
    { table: "base_mail_dispatch", from: "delivery_outbox", where: "delivery_id=COALESCE(json_extract(?,'$.providerIdempotencyKey'),?)", params: ["payload_json", "idempotency_key"] },
    { table: "provider_webhook_events", from: "base_mail_dispatch", on: { delivery_id: "delivery_id" } },
    { table: "rer_mail_development_outbox", from: root, where: `EXISTS(SELECT 1 FROM json_each(message,'$.to') WHERE value=${email})`, params: [recipient] },
    { table: "rer_mail_development_outbox", from: "oa_tokens", where: "json_extract(message,'$.deliveryId')=?", params: ["id"] },
    // Sign-in counters correlated to this operator when written (DATA-002).
    ...rateEdges({ entity: "operator", root: { table: root, column: "id" }, counters: [{ table: "oa_limits", keyColumn: "key" }] }),
  ];
  return defineErasure({ entity: retainNative ? "operator-author" : "operator", root: { table: root }, edges,
    retain: [
      { table: "oa_domain_rules", reason: "Shared domain policies retain the original anonymous author ID and all policy values." },
      ...(retainNative ? [{ table: "oa_operators", reason: "Inactive anonymous author reference only; native capabilities and identifying fields are erased in the same batch." }] : []),
    ],
  });
}
