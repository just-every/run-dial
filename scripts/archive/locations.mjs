const types = new Set(['google_meet', 'microsoft_teams', 'fixed_link', 'phone', 'invitee_phone', 'in_person', 'ask_invitee', 'custom']);
export function validateLocations(name, row) {
  if (name !== 'event_types' || row.locations_json === null) return;
  let options;
  try { options = JSON.parse(row.locations_json); } catch { throw new Error('archive-invalid-event-locations'); }
  if (!Array.isArray(options) || options.length < 1 || options.length > 8 || new Set(options.map(option => option?.id)).size !== options.length || options.some(option => !option || typeof option !== 'object' || Array.isArray(option) || typeof option.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(option.id) || !types.has(option.type) || typeof option.label !== 'string' || !option.label.trim() || option.label.length > 180 || typeof option.value !== 'string' || option.value.length > 1000 || option.prompt !== undefined && (typeof option.prompt !== 'string' || option.prompt.length > 500))) throw new Error('archive-invalid-event-locations');
}
