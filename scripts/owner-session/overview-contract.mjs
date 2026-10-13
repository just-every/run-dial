import {must} from './assert.mjs';
export const overviewViewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
export const checklistIds = ['profile','mail','calendar','availability','event','publication','copy'];
export function overviewMode(value = 'requests') {
  must(['requests', 'connected'].includes(value),'overview-mode-required');return value;
}
export function readOnlyOverviewRequest(method, url, origin) {
  const target = new URL(url);
  if (['data:', 'blob:'].includes(target.protocol)) return method === 'GET';
  if (target.pathname.startsWith('/api/app/calendar/') && !['/api/app/calendar/connection', '/api/app/calendar/setup'].includes(target.pathname)) return false;
  // Maintained GET platform-health performs its documented nondomain Queue probe.
  // No user data, configuration, calendar or clipboard report is changed here.
  return method === 'GET' && target.origin === origin && !/\/api\/calendar\/oauth(?:\/|$)/.test(target.pathname);
}
export function checkedTime(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
export function statusTime(value) {
  must(checkedTime(value),'overview-invalid-check-time');
  return `${new Intl.DateTimeFormat('en-US',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))} (UTC)`;
}
export function assertOverviewState(value, mode, expectedUrl) {
  overviewMode(mode);
  must(value.mail.state === 'healthy', 'overview-mail-not-healthy');
  for (const name of ['database','storage','queue']) must(value.platform.checks[name] === 'ok', `overview-${name}-not-ok`);
  must(checkedTime(value.mail.checkedAt) && checkedTime(value.platform.checkedAt), 'overview-missing-check-time');
  must(Array.isArray(value.steps) && value.steps.length === 7 && checklistIds.every(id => value.steps.filter(step => step.id === id && typeof step.done === 'boolean').length === 1), 'overview-checklist-identities');
  must(value.checklist.length === 7 && value.steps.every(step => value.checklist.filter(row => row.id === step.id && row.done === step.done).length === 1),'overview-rendered-checklist-mismatch');
  const links=value.links.filter(link => link.url === expectedUrl);
  must(links.length === 1 && checkedTime(links[0].copiedAt),'overview-current-copy-unproven');
  if (mode === 'connected') {
    must(value.calendar.state === 'healthy' && checkedTime(value.calendar.checkedAt), 'overview-calendar-not-healthy');
    must(value.steps.every(step => step.done), 'overview-checklist-incomplete');
  } else {
    must(value.calendar.state === 'disconnected', 'overview-calendar-not-disconnected');
    must(typeof value.calendar.reason === 'string' && value.calendar.reason.length > 0,'overview-calendar-cause-missing');
    must(links[0].requestOnly === true, 'overview-requests-not-open');
    must(value.steps.filter(step => step.id !== 'calendar').every(step => step.done), 'overview-request-checklist-incomplete');
    must(value.steps.some(step => step.id === 'calendar' && !step.done), 'overview-calendar-step-missing');
  }
  return true;
}
