// Capacity is host configuration. Seats are the ordinary private booking and
// occurrence records, with the same archive exclusions and erasure custody.
export function validateGroupEvents(name, row) {
  if (name !== 'event_types' || row.group_capacity === null) return;
  if (!Number.isInteger(row.group_capacity) || row.group_capacity < 2 || row.group_capacity > 1000) throw new Error('archive-invalid-group-capacity');
}
