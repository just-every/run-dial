import assert from 'node:assert/strict';

/** Follow the native booking row and compare its history with authenticated HTTP data. */
export async function assertNativeImportedHistory({ context, page, origin, report, width, audit }) {
  const sessionResponse = await context.request.get(`${origin}/api/app/session`);
  assert.equal(sessionResponse.status(), 200);
  const { operator } = await sessionResponse.json();
  assert.ok(operator?.id);
  assert.ok(operator?.email);

  const listResponse = await context.request.get(`${origin}/api/app/bookings`);
  assert.equal(listResponse.status(), 200);
  const bookings = await listResponse.json();
  const listedBooking = bookings.find(booking => Boolean(booking.imported));
  assert.ok(listedBooking, 'The native booking list contains an imported booking.');

  const detailResponse = await context.request.get(`${origin}/api/app/bookings/${listedBooking.id}`);
  assert.equal(detailResponse.status(), 200);
  const booking = await detailResponse.json();
  assert.equal(booking.id, listedBooking.id);
  assert.ok(booking.imported);
  const creations = booking.history.filter(entry => entry.action === 'created');
  assert.equal(creations.length, 1, 'The imported booking has one native creation entry.');
  const [creation] = creations;
  assert.equal(creation.actorType, 'operator');
  assert.equal(creation.actorId, operator.id);
  assert.equal(creation.previousStartAt, null);
  assert.equal(creation.newStartAt, booking.occurrence.startAt);
  assert.equal(creation.createdAt, report.asOf);
  assert.notEqual(booking.createdAt, creation.createdAt);
  assert.ok(creation.reason?.trim());

  const row = page.getByRole('button')
    .filter({ has: page.getByText(listedBooking.inviteeName, { exact: true }) })
    .filter({ hasText: listedBooking.eventTitle });
  await row.waitFor();
  assert.equal(await row.count(), 1, 'The imported booking is selectable through its native row.');
  await row.click();
  await page.getByRole('heading', { name: booking.inviteeName, exact: true }).waitFor();
  const history = page.getByRole('region', { name: 'Booking history' });
  await history.waitFor();
  const entry = history.getByRole('listitem')
    .filter({ has: page.getByText(creation.reason, { exact: true }) });
  await entry.waitFor();
  assert.equal(await entry.count(), 1, 'The native creation reason identifies one visible history entry.');
  await entry.getByText(operator.email, { exact: false }).waitFor();
  await entry.getByText(creation.reason, { exact: true }).waitFor();
  const visible = await entry.innerText();
  assert.ok(visible.includes(operator.email));
  assert.ok(!visible.includes(operator.id), "History identifies the person without exposing the internal actor id.");
  assert.ok(visible.includes(creation.reason), 'The visible history retains the API explanation of snapshot-effective time.');

  // The reviewed instant, source creation and imported start are separate values.
  // Checking the complete list also excludes a fabricated previous-start time.
  const expectedInstants = [creation.createdAt, booking.createdAt, creation.newStartAt];
  const times = entry.locator('time[datetime]');
  assert.deepEqual(await times.evaluateAll(elements => elements.map(element => element.getAttribute('datetime'))), expectedInstants);
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: booking.hostTimezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  await page.getByText(`Times in ${booking.hostTimezone}`, { exact: true }).waitFor();
  for (const [index, instant] of expectedInstants.entries()) {
    const time = times.nth(index);
    await time.waitFor({ state: 'visible' });
    const displayed = await time.innerText();
    const parts = formatter.formatToParts(new Date(instant)).filter(part => part.type !== 'literal' && !(part.type === 'minute' && part.value === '00'));
    assert.ok(parts.every(part => displayed.includes(part.value)), "The history time uses the host's local clock.");
  }
  const fitsViewport = await history.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= globalThis.innerWidth && element.scrollWidth <= element.clientWidth;
  });
  assert.ok(fitsViewport, `Imported booking history fits the ${width}px viewport.`);
  await audit('booking-history');
}
