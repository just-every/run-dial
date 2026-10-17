/** Both diagnostics and atomic admission execute this same query against current policies. */
export const bookingLimitViolationsSql = `
WITH candidate AS (SELECT ? AS data),
policies AS (
  SELECT scope, limits_json FROM booking_limit_policies
  WHERE scope = 'host' OR scope = (SELECT json_extract(data, '$.eventId') FROM candidate)
),
periods AS (
  SELECT json_extract(value, '$.name') AS name,
         json_extract(value, '$.startAt') AS start_at,
         json_extract(value, '$.endAt') AS end_at
  FROM candidate, json_each(candidate.data, '$.periods')
),
totals AS MATERIALIZED (
  SELECT policies.scope, policies.limits_json, periods.name,
    (SELECT json_object(
       'count', count(*),
       'durationMs', coalesce(sum(
         round(unixepoch(occurrence.end_at, 'subsec') * 1000) -
         round(unixepoch(occurrence.start_at, 'subsec') * 1000)
       ), 0))
     FROM booking_occurrences occurrence
     JOIN bookings booking ON booking.id = occurrence.booking_id
     WHERE occurrence.is_current = 1
       AND booking.state IN ('confirmed', 'rescheduled')
       AND occurrence.start_at >= periods.start_at
       AND occurrence.start_at < periods.end_at
       AND (policies.scope = 'host' OR booking.event_type_id = policies.scope)
       AND booking.id IS NOT json_extract(candidate.data, '$.excludedBookingId')
    ) AS usage
  FROM policies CROSS JOIN periods CROSS JOIN candidate
  WHERE json_extract(policies.limits_json, '$.' || periods.name || 'Count') IS NOT NULL
     OR json_extract(policies.limits_json, '$.' || periods.name || 'Minutes') IS NOT NULL
),
invitee_gap AS (
  SELECT coalesce(max(json_extract(limits_json, '$.inviteeGapMinutes')), 0) AS minutes
  FROM policies
)
SELECT (CASE WHEN scope = 'host' THEN 'host' ELSE 'event' END) || '_' || name || '_count' AS reason
FROM totals
WHERE json_extract(usage, '$.count') + 1 > json_extract(limits_json, '$.' || name || 'Count')
UNION ALL
SELECT (CASE WHEN scope = 'host' THEN 'host' ELSE 'event' END) || '_' || name || '_minutes' AS reason
FROM totals CROSS JOIN candidate
WHERE json_extract(usage, '$.durationMs') + json_extract(candidate.data, '$.durationMs')
      > json_extract(limits_json, '$.' || name || 'Minutes') * 60000
UNION ALL
SELECT 'invitee_gap' AS reason
FROM candidate CROSS JOIN invitee_gap
WHERE invitee_gap.minutes > 0
  AND json_extract(candidate.data, '$.inviteeEmail') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM bookings booking
    JOIN booking_occurrences occurrence ON occurrence.booking_id = booking.id
    WHERE lower(trim(booking.invitee_email)) = json_extract(candidate.data, '$.inviteeEmail')
      AND booking.state IN ('confirmed', 'rescheduled')
      AND occurrence.is_current = 1
      AND booking.id IS NOT json_extract(candidate.data, '$.excludedBookingId')
      AND unixepoch(occurrence.start_at, 'subsec') * 1000
          < json_extract(candidate.data, '$.endMs') + invitee_gap.minutes * 60000
      AND unixepoch(occurrence.end_at, 'subsec') * 1000
          > json_extract(candidate.data, '$.startMs') - invitee_gap.minutes * 60000
  )`;
