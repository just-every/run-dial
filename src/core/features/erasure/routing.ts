import { emailFoldSql, foldEmail } from "./identity";
import type { PortabilityFence } from "../../../modules/erasure/index.mjs";
import { toD1Sql } from "../../../modules/erasure/index.mjs";
import type { ErasureStatement } from "./booking-statements";

/** Match whole email leaves, including multi-choice answers; never substrings. */
const emailMatch = `${emailFoldSql("s.invitee_email")} IN(SELECT value FROM json_each(?)) OR EXISTS(
  SELECT 1 FROM json_tree(s.answers_json) answer
  WHERE answer.type='text' AND lower(trim(answer.atom)) IN(SELECT value FROM json_each(?)))`;
const columns = ["id", "form_id", "capability_id", "form_title", "rule_id", "rule_label", "answers_json", "attribution_json", "invitee_email", "booking_id", "created_at", "updated_at"];
const snapshot = `json_object(${columns.flatMap(column => [`'${column}'`, `s.${column}`]).join(",")},
  'handoff', (SELECT json_object('token_hash',h.token_hash,'event_type_id',h.event_type_id,'expires_at',h.expires_at,'created_at',h.created_at,'booking_claim_id',h.booking_claim_id) FROM routing_handoffs h WHERE h.submission_id=s.id),
  'capability', (SELECT json_object('form_id',t.form_id,'token_hash',t.token_hash,'expires_at',t.expires_at,'consumed_at',t.consumed_at,'created_at',t.created_at) FROM routing_submission_tokens t WHERE t.id=s.capability_id))`;
const scopeSql = `SELECT json_group_array(json(value)) FROM (SELECT ${snapshot} AS value FROM routing_submissions s WHERE ${emailMatch} ORDER BY s.id)`;

/** Private scope binds payloads and capabilities as well as membership. */
export async function routingScope(db: D1Database, emails: string[]) {
  const values = JSON.stringify(emails.map(foldEmail));
  return (await db.prepare(`SELECT (${scopeSql}) AS scope`).bind(values, values).first<{scope:string}>())?.scope ?? "[]";
}
export function routingScopeGuard(db: D1Database, emails: string[], expected: string) {
  const values = JSON.stringify(emails.map(foldEmail));
  return db.prepare(`SELECT CASE WHEN (${scopeSql})=? THEN 1 ELSE abs(-9223372036854775808) END`).bind(values, values, expected);
}

type DeleteRows = (db: D1Database, fence: PortabilityFence, table: string, where: string, params: unknown[]) => Promise<ErasureStatement[]>;
/** Anonymous unused tokens contain no personal value and retain no submission link. */
export async function routingRemainders(db: D1Database, fence: PortabilityFence & {redactionStatements():Promise<D1PreparedStatement[]>}, emails: string[], deleteRows: DeleteRows) {
  const scope = await routingScope(db, emails);
  const rows = JSON.parse(scope) as {id:string;capability_id:string|null;booking_id:string|null}[];
  const ids = JSON.stringify(rows.map(row => row.id));
  const tokens = JSON.stringify(rows.flatMap(row => row.capability_id ? [row.capability_id] : []));
  const bookingIds=JSON.stringify(rows.flatMap(row=>row.booking_id?[row.booking_id]:[]));
  return [
    ...(rows.some(row=>row.booking_id)?(await fence.redactionStatements()).map(toD1Sql):[]),
    ...await deleteRows(db,fence,"booking_answers","booking_id IN(SELECT value FROM json_each(?)) AND question_key LIKE 'routing.%'",[bookingIds]),
    ...await deleteRows(db,fence,"booking_nonces","result_booking_id IN(SELECT value FROM json_each(?))",[bookingIds]),
    {sql:"UPDATE bookings SET post_booking_redirect_url=NULL WHERE id IN(SELECT value FROM json_each(?))",params:[bookingIds]},
    { sql: `SELECT CASE WHEN (${scopeSql})=? THEN 1 ELSE abs(-9223372036854775808) END`, params: [JSON.stringify(emails.map(foldEmail)), JSON.stringify(emails.map(foldEmail)), scope] },
    ...["payment_holds","booking_approval_requests"].map(table=>({sql:`UPDATE ${table} SET claim_json=json_set(claim_json,'$.routing.answers',json('[]'),'$.routing.attribution',json('{}'),'$.postBookingRedirectUrl',NULL) WHERE json_extract(claim_json,'$.routing.submissionId') IN(SELECT value FROM json_each(?))`,params:[ids]})),
    ...await deleteRows(db, fence, "routing_handoffs", "submission_id IN(SELECT value FROM json_each(?))", [ids]),
    ...await deleteRows(db, fence, "routing_submissions", "id IN(SELECT value FROM json_each(?))", [ids]),
    ...await deleteRows(db, fence, "routing_submission_tokens", "id IN(SELECT value FROM json_each(?))", [tokens]),
  ];
}
