// Persisted zones must already be canonical: restore never rewrites owner data.
const zones = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
const zone = value => typeof value === 'string' && zones.has(value);
const boundedInteger = value => value === null || Number.isInteger(value) && value >= 0 && value <= 2_147_483_647;

export function validateBookingPolicy(name, row) {
  if (name === 'event_booking_policies' && (
    row.locked_timezone !== null && !zone(row.locked_timezone) ||
    ['reschedule_cutoff_minutes', 'cancellation_cutoff_minutes', 'reschedule_cap'].some(key => !boundedInteger(row[key]))
  )) throw new Error('archive-invalid-event-booking-policy');
  if (name === 'availability_requests' && row.browser_timezone !== null && !zone(row.browser_timezone)) throw new Error('archive-invalid-request-browser-timezone');
  if (name === 'booking_presentation' && (
    !zone(row.locked_timezone) || row.browser_timezone !== null && !zone(row.browser_timezone)
  )) throw new Error('archive-invalid-booking-presentation');
}
