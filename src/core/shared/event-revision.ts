// Evaluate against the persisted row inside each write, so simultaneous writers and
// a stalled or backwards wall clock cannot reuse a checked configuration revision.
export const afterPersistedTimestampSql = "strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')";
export const nextEventTimestampSql = `max(?, ${afterPersistedTimestampSql})`;
