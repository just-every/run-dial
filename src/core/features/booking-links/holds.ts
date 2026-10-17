/** The same durable hold predicate protects every atomic booking write. */
export function offeredHoldPredicate(startAt: string, endAt: string, exceptLinkId?: string) {
  return { sql: `NOT EXISTS (SELECT 1 FROM booking_links l JOIN booking_link_tokens t ON t.link_id=l.id, json_each(l.offered_slots_json) s
    WHERE l.consumed_at IS NULL AND l.revoked_at IS NULL
      AND l.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND l.hold_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND json_extract(s.value,'$.occupiedStartAt')<? AND json_extract(s.value,'$.occupiedEndAt')>?
      AND (? IS NULL OR l.id<>?))`, params: [endAt,startAt,exceptLinkId ?? null,exceptLinkId ?? null] };
}
export type OfferedSlot = { startAt: string; endAt: string; occupiedStartAt: string; occupiedEndAt: string };
