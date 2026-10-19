// Archive commands run without a TypeScript loader. Validate the stored shape
// and variable language here; question existence/privacy belongs to native edits.
const keys = ['calendarTitle', 'calendarDescription', 'confirmationSubject', 'confirmationBody', 'rescheduleSubject', 'rescheduleBody', 'cancellationSubject', 'cancellationBody', 'reminderSubject', 'reminderBody', 'rescheduleRequestSubject', 'rescheduleRequestBody', 'rescheduleRequestReminderSubject', 'rescheduleRequestReminderBody'];
const variables = new Set(['invitee full name', 'invitee first name', 'host name', 'event name', 'date and time', 'duration', 'location', 'manage link', 'message']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateCorrespondence(name, row) {
  if (!['event_correspondence', 'booking_correspondence'].includes(name)) return;
  let config;
  try { config = JSON.parse(row.templates_json); } catch { throw new Error('archive-invalid-correspondence'); }
  if (!object(config) || Object.keys(config).some(key => !['templates', 'inviteeConfirmationEnabled'].includes(key)) || Object.hasOwn(config, 'inviteeConfirmationEnabled') && typeof config.inviteeConfirmationEnabled !== 'boolean' || !Object.hasOwn(config, 'templates') || !object(config.templates)
    || Object.keys(config.templates).some(key => !keys.includes(key)) || keys.slice(0, 10).some(key => !Object.hasOwn(config.templates, key))) throw new Error('archive-invalid-correspondence');
  for (const key of keys) {
    const template = config.templates[key];
    if (template === null || template === undefined) continue;
    const singleLine = key === 'calendarTitle' || key.endsWith('Subject');
    if (typeof template !== 'string' || template.length < 1 || template.length > (singleLine ? 500 : 10_000)
      || singleLine && [...template].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('archive-invalid-correspondence');
    for (const token of template.matchAll(/\{([^{}]*)\}|[{}]/gu)) {
      const variable = token[1];
      if (variable === undefined || !variables.has(variable) && !/^answer\.q_[A-Za-z0-9_-]{10,80}$/u.test(variable)
        || key.startsWith('calendar') && ['manage link', 'message'].includes(variable)) throw new Error('archive-invalid-correspondence-variable');
    }
  }
}
