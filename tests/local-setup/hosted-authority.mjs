import assert from 'node:assert/strict';
/** A second real owner proves that possession of a job ID is not its authority. */
export async function anotherHostedOwner(page, origin) {
 const invite = await page.request.post(origin + '/api/app/operators', { headers: { origin }, data: { email: 'other-export-owner@example.test' } });
 assert.equal(invite.status(), 201);
 const outbox = await page.context().newPage(); let context;
 try {
  await outbox.goto(origin + '/__dev/outbox');
  const invitation = outbox.locator('article').filter({ has: outbox.getByRole('heading', { name: "You're invited to Dial", exact: true }) }).first();
  await invitation.getByRole('link', { name: 'Read message', exact: true }).click();
  const link = await outbox.getByRole('link', { name: 'Open this link', exact: true }).getAttribute('href');
  assert.ok(link);
  context = await page.context().browser().newContext();
  const recipient = await context.newPage();
  await recipient.goto(link);
  await recipient.getByRole('button', { name: 'Confirm', exact: true }).click();
  await recipient.waitForURL(origin + '/app');
  let cookie;
  for (const item of await context.cookies(origin)) {
   const candidate = `${item.name}=${item.value}`;
   if ((await fetch(origin + '/api/app/session', { headers: { Cookie: candidate } })).ok) { cookie = candidate; break; }
  }
  assert.ok(cookie);
  return cookie;
 } finally { await outbox.close(); await context?.close(); }
}
