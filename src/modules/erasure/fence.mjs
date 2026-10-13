import { insist } from './sql.mjs';

/** The restore fence is portability's: every deleted row gets that service's
 * erasureStatements, and every commit drops in-flight transfer copies. */
export function fenceCalls(portability) {
  insist(portability && typeof portability.erasureStatements === 'function' && typeof portability.invalidateTransfersStatements === 'function', 'portability_service');
  return {
    row: (table, key) => portability.erasureStatements(table, key),
    redaction: () => portability.redactionStatements(),
    transfers: () => portability.invalidateTransfersStatements(),
  };
}

/** import-kit takes `{sql, params}` (its D1Sql). Workers' D1 prepared statements
 * carry their text and bindings as `statement` and `params`; refuse anything else. */
export function toD1Sql(prepared) {
  insist(prepared && typeof prepared.statement === 'string' && Array.isArray(prepared.params), 'statement_not_convertible');
  return { sql: prepared.statement, params: [...prepared.params] };
}
