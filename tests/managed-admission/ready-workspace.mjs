import assert from 'node:assert/strict';

/** Complete native first run with the admitted owner's session and product HTTP API. */
export async function establishEditorWorkspace(origin, cookie) {
  async function json(path, { method = 'GET', body, headers = {} } = {}, expected = 200) {
    const response = await fetch(origin + path, {
      method, redirect: 'manual',
      headers: { origin, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, expected, `Managed editor fixture setup: ${method} ${path}`);
    return response.json();
  }

  assert.equal((await json('/api/app/host-setup')).completedAt, null);
  await json('/api/app/profile', { method: 'PATCH', body: {
    handle: 'editor-reviewer', name: 'Editor reviewer', title: 'Synthetic editor workspace',
    biography: 'A synthetic workspace prepared for the native managed editor journey.',
    timezone: 'UTC', focusAreas: [], socialProof: [],
  } });
  assert.equal((await json('/api/app/mail/check', { method: 'POST' })).state, 'healthy');
  const event = await json('/api/app/event-types', { method: 'POST', body: {
    slug: 'setup-request', title: 'Synthetic setup request', description: 'A request-only event for completing native first run.',
    durationMinutes: 30, color: '#176b5a', locationType: 'fixed_link', locationLabel: 'Meeting',
    locationValue: 'https://meet.example.test/setup', listed: true, alternativeRequestsEnabled: true,
    slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bookingHorizonDays: 90,
    beforeBufferMinutes: 0, afterBufferMinutes: 0, hostDayBookingLimit: null, questions: [], availability: [],
  } }, 201);
  const opened = await json(`/api/app/event-types/${event.id}/open-requests`, { method: 'POST' });
  assert.equal(opened.status, 'published');
  assert.equal(opened.requestOnly, true);
  const ready = await json('/api/app/host-setup');
  const link = ready.links.find(candidate => candidate.eventTypeId === event.id);
  assert.ok(link, 'Native setup exposes the current public booking link');
  await json(`/api/app/event-types/${event.id}/copy-report`, {
    method: 'POST', headers: { 'X-Dial-Copy-Report': '1' }, body: { url: link.url },
  });
  const completion = await json('/api/app/host-setup/complete', { method: 'POST' });
  assert.equal(completion.kind, 'completed');
  assert.ok(completion.completedAt);
  assert.equal((await json('/api/app/host-setup')).completedAt, completion.completedAt);
}
