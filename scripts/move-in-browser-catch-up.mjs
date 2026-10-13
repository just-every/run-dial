import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertReport } from '../tests/move-in/report-validator.mjs';
import { evidencePath } from './evidence-path.mjs';

// DATA-003 catch-up and switch-over, through the hydrated Settings → Move in page.
// The worker's fixture providers stand in for Google and mail at the paid edge only.
async function json(context, origin, path, options = {}, expected = 200) {
 const response = await context.request.fetch(origin + path, { ...options, headers: { Origin: origin, ...options.headers }, maxRedirects: 0 });
 assert.equal(response.status(), expected, `${options.method ?? 'GET'} ${path}`);
 return response.json();
}
async function continueImport(page) {
 for (let n = 0; n < 40 && await page.getByRole('button', { name: 'Continue import' }).count(); n++) { await page.getByRole('button', { name: 'Continue import' }).click(); await page.getByText('Working on this bounded batch…').waitFor({ state: 'hidden' }); }
 await page.getByRole('button', { name: 'Undo import', exact: true }).waitFor();
}
async function previewAndDownload(page, width, name) {
 await page.getByRole('button', { name: 'Preview saved data', exact: true }).click();
 await page.getByRole('button', { name: 'Download JSON report' }).waitFor();
 const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download JSON report' }).click();
 await (await download).saveAs(evidencePath(`move-in-${width}-${name}-report.json`));
 const report = JSON.parse(await readFile(evidencePath(`move-in-${width}-${name}-report.json`), 'utf8')); assertReport(report); return report;
}
async function apply(page) {
 await page.getByLabel('I acknowledge all listed losses, rejected overlaps and changed values.').check();
 await page.getByRole('button', { name: 'Apply reviewed import' }).click();
 await page.getByText('Working on this bounded batch…').waitFor({ state: 'hidden' });
 await continueImport(page);
}

/** A second capture adds two bookings, repeats three and finds the edited one untouched; undo removes only the catch-up. */
export async function catchUpJourney({ page, context, origin, width, audit, selectFiles }) {
 const bookings = async () => (await json(context, origin, '/__fixtures/import-status')).bookings;
 const edited = (await bookings()).find(row => row.invitee_email === 'guest-1@example.test');
 const field = await json(context, origin, '/api/app/custom-fields', { method: 'POST', data: { entity: 'booking', label: 'Owner note', kind: 'text' } }, 201);
 await json(context, origin, `/api/app/custom-fields/booking/${edited.id}/${field.id}`, { method: 'PUT', data: { value: 'Prefers mornings' } });
 const firstImport = await bookings();
 await page.clock.setSystemTime(new Date('2027-01-02T00:00:00.000Z'));
 await page.goto(origin + '/app/settings#move-in'); await selectFiles('solo-later');
 const report = await previewAndDownload(page, width, 'catch-up');
 assert.equal(report.mode, 'catch-up'); assert.equal(report.differences.length, 10); assert.equal(report.bookingCounts.toImport, 2);
 await page.getByText('Catch-up: 4 event types and 6 bookings are already here', { exact: false }).waitFor();
 await page.getByRole('region', { name: 'Differences from this capture' }).getByText('Cancelled at source', { exact: false }).waitFor();
 await audit('catch-up-preview');
 await apply(page); await audit('catch-up-applied');
 const status = await json(context, origin, '/__fixtures/import-status');
 assert.equal(status.delivery_outbox.length, 0); assert.equal(status.fixture_mail.length, 0); assert.equal(status.fixture_events.length, 0);
 // Only the switch-over checklist's read-only connection checks reach the providers.
 assert.ok(status.fixture_activity.every(row => ['check', 'busy', 'sync'].includes(row.kind)), JSON.stringify(status.fixture_activity.map(row => row.kind)));
 assert.equal(status.bookings.length, firstImport.length + 2, 'repeats are not duplicated');
 assert.deepEqual(status.bookings.find(row => row.id === edited.id), firstImport.find(row => row.id === edited.id), 'the Dial edit survives');
 assert.equal((await json(context, origin, `/api/app/custom-fields/booking/${edited.id}`)).find(entry => entry.id === field.id).value, 'Prefers mornings');
 // The two new bookings hold their time against a native public event.
 await json(context, origin, '/__fixtures/import-public', { method: 'POST' });
 const slots = (await json(context, origin, '/api/public/book/solo/native-public/availability?week=2027-01-18&inviteeTimezone=UTC')).slots.map(slot => slot.startAt);
 assert.ok(slots.length > 0); for (const taken of ['2027-01-21T15:00:00.000Z', '2027-01-22T15:00:00.000Z']) assert.ok(!slots.includes(taken), taken);
 await context.request.delete(origin + '/__fixtures/import-public');
 page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Undo import', exact: true }).click(); await page.getByText('Working on this bounded batch…').waitFor({ state: 'hidden' });
 for (let n = 0; n < 40 && await page.getByRole('button', { name: 'Continue import' }).count(); n++) { await page.getByRole('button', { name: 'Continue import' }).click(); await page.getByText('Working on this bounded batch…').waitFor({ state: 'hidden' }); }
 await page.getByText(/^undone:/u).waitFor(); await audit('catch-up-undone');
 assert.deepEqual(await bookings(), firstImport, 'undoing the catch-up leaves the first import intact');
 // Clear the owner note so the journey's later undo of the first import reverses every record.
 await json(context, origin, `/api/app/custom-fields/booking/${edited.id}/${field.id}`, { method: 'PUT', data: { value: null } });
}

/** One imported type published, a catch-up applied, its differences decided: every switch-over row turns clear. */
export async function switchOverJourney({ page, context, origin, width, audit, selectFiles }) {
 await json(context, origin, '/__fixtures/import-empty', { method: 'POST' });
 await page.clock.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
 // A fresh page: the earlier edges review left owner choices in the card's state.
 await page.goto(origin + '/app'); await page.goto(origin + '/app/settings#move-in'); await selectFiles('cutover');
 assert.equal((await previewAndDownload(page, width, 'cutover')).mode, 'first');
 await apply(page);
 const card = page.locator('#switch-over');
 await card.getByText('Still open:', { exact: false }).waitFor();
 await card.getByText('imported event types are not all published', { exact: false }).waitFor();
 await audit('switch-over-open');
 const links = page.waitForEvent('download'); await card.getByRole('link', { name: 'Download the link list' }).click();
 const csv = await readFile(await (await links).path(), 'utf8');
 assert.match(csv, /"Intro call","https:\/\/schedule\.example\.test\/cutover-host\/intro-call","[^"]+\/book\/cutover-host\/intro-call","draft"/u);
 const event = (await json(context, origin, '/api/app/event-types')).find(row => row.title === 'Intro call');
 await page.goto(`${origin}/app/event-types/${event.id}`);
 await page.getByRole('button', { name: 'Publish event type' }).click();
 await page.getByRole('button', { name: 'Update published event' }).waitFor();
 await page.clock.setSystemTime(new Date('2026-02-05T00:00:00.000Z'));
 await page.goto(origin + '/app/settings#move-in'); await selectFiles('cutover-later');
 const report = await previewAndDownload(page, width, 'cutover-catch-up');
 assert.deepEqual(Object.fromEntries(report.differences.map(item => [item.name, item.kind])), { 'Ada Lane': 'unchanged', 'Ben Hart': 'cancelled', 'Cy Moss': 'moved' });
 await apply(page);
 const differences = page.getByRole('region', { name: 'Differences from this capture' });
 await differences.getByRole('listitem').filter({ hasText: 'Ben Hart' }).getByRole('button', { name: 'Release this time' }).click();
 await differences.getByText('Time released without an email').waitFor();
 await differences.getByRole('listitem').filter({ hasText: 'Cy Moss' }).getByRole('button', { name: 'Keep the Dial time' }).click();
 await differences.getByText('Kept as it is in Dial').waitFor();
 await card.getByText('Every row is clear.').waitFor();
 await audit('switch-over-clear');
 const status = await json(context, origin, '/__fixtures/import-status');
 assert.equal(status.delivery_outbox.length, 0, 'release sends no email'); assert.equal(status.fixture_mail.length, 0);
 assert.equal(status.bookings.find(row => row.invitee_email === 'ben-hart@example.test').state, 'cancelled');
}
