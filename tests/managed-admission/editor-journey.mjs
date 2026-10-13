import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const edits = [
  { path: '/app', text: 'Published owner overview' },
  { path: '/app/settings', text: 'Published owner settings' },
];

/** Publish a real source snapshot, using targets observed on the native pages. */
export async function publishCompiledEdits(page, origin, file) {
  const snapshot = { revision: 1, edits: [] };
  for (const [index, edit] of edits.entries()) {
    await page.goto(origin + edit.path);
    const heading = page.locator('main h1'); await heading.waitFor();
    const target = await heading.evaluate(element => {
      const parts = [];
      for (let node = element; node; node = node.parentElement) {
        parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${Array.from(node.parentNode.children).indexOf(node) + 1})`);
      }
      return { selector: parts.join(' > '), tag: element.tagName.toLowerCase(), role: element.getAttribute('role') || '', beforeText: element.textContent.replace(/\s+/g, ' ').trim() };
    });
    snapshot.edits.push({ id: `owner-heading-${index}`, revision: 1, path: edit.path, target, change: { text: edit.text } });
  }
  await writeFile(file, JSON.stringify(snapshot) + '\n');
  // The router imports this source snapshot, so publication can reload the page.
  // Observe the compiled edit on the current route before starting navigation.
  await page.getByRole('heading', { name: edits.at(-1).text, exact: true }).waitFor();
  await page.waitForLoadState('load');
}

export async function compiledNavigation(page, origin, width) {
  await page.goto(origin + edits[0].path);
  await page.getByRole('heading', { name: edits[0].text, exact: true }).waitFor();
  for (const edit of [edits[1], edits[0], edits[1], edits[0]]) {
    if (width < 1024) await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.locator(`nav a[href="${edit.path}"]`).filter({ visible: true }).click();
    await page.waitForURL(origin + edit.path);
    await page.getByRole('heading', { name: edit.text, exact: true }).waitFor();
  }
}

/** Delay only the real network response, keeping the native authorization intact. */
export async function focusedEditorContinuity(page, context, frame) {
  const original = await frame.elementHandle();
  const draft = frame.contentFrame().getByLabel('Private editor draft');
  await draft.fill('Unsaved owner draft survives focus');
  let release, observed, timeout;
  const held = new Promise(resolve => { release = resolve; });
  const arrived = new Promise(resolve => { observed = resolve; });
  let count = 0;
  const defer = async route => {
    const response = await route.fetch();
    if (++count === 1) { observed(); await held; }
    await route.fulfill({ response });
  };
  await context.route('**/api/editor/config', defer);
  try {
    await page.evaluate(() => globalThis.dispatchEvent(new Event('focus')));
    await Promise.race([arrived, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Owner focus did not revalidate configuration')), 10_000); })]);
    clearTimeout(timeout);
    await page.evaluate(() => { globalThis.dispatchEvent(new Event('focus')); globalThis.dispatchEvent(new Event('focus')); });
    assert.equal(await original.evaluate(element => element.isConnected), true, 'pending focus keeps the authorized iframe');
    release();
    // A coalesced focus must revalidate again after the in-flight request.
    await page.waitForResponse(response => response.url().endsWith('/api/editor/config') && count >= 2);
    assert.equal(await original.evaluate(element => element.isConnected), true, 'same owner and equivalent grant keep the original iframe');
    assert.equal(await frame.isVisible(), true);
    assert.equal(await draft.inputValue(), 'Unsaved owner draft survives focus');
  } finally { clearTimeout(timeout); release(); await context.unroute('**/api/editor/config', defer); await original.dispose(); }
}
