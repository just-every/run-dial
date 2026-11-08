import assert from 'node:assert/strict';
import { randomUUID, webcrypto } from 'node:crypto';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { serveHosted, HOSTED_ORIGIN } from '@runeditrun/rer/internal/cli/hosted-output.mjs';
import { signJws, seconds, autonomousPolicy, heldPolicy } from '../../modules/agent-door/conformance/crypto.mjs';
import { createProtocol } from '../../modules/agent-door/conformance/protocol.mjs';
import initialize from './native-owner.mjs';
import { createFixtureControl } from '@runeditrun/rer/internal/cli/agent-fixtures.mjs';
import { evidencePath } from '../../scripts/evidence-path.mjs';

// One public-door journey, reused by the native conformance leg and push Verify.
export default async function documentationJourney() {
  const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'));
  const origin = HOSTED_ORIGIN, token = randomUUID(), kid = randomUUID(), installationId = randomUUID();
  const issuer = 'https://synthetic-dial-issuer.invalid', email = surface.verification.owner.email;
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKeys = JSON.stringify({ [kid]: { ...await webcrypto.subtle.exportKey('jwk', pair.publicKey), kid, alg: 'ES256', use: 'sig' } });
  let providerCalls = 0;
  const hosted = await serveHosted(process.cwd(), { bindings: {
    OWNER_EMAIL: email, SETUP_TOKEN: token, RER_OWNER_CLAIM_ISSUER: issuer,
    RER_OWNER_CLAIM_INSTALLATION_ID: installationId, RER_OWNER_CLAIM_APP_ORIGIN: origin,
    RER_OWNER_CLAIM_PUBLIC_KEYS: publicKeys,
  }, outboundService: () => { providerCalls++; throw new Error('Documentation must never request a provider'); } });
  let browser;
  try {
    const request = (absolute, init = {}) => {
      const url = new URL(absolute); assert.equal(url.origin, origin);
      return hosted.fetch(url.href.slice(origin.length + 1), { ...init, headers: Object.fromEntries(new Headers(init.headers)) });
    };
    const iat = seconds();
    const signed = await signJws(pair.privateKey, kid, 'rer-owner-claim+jwt', { v: 1, iss: issuer, aud: origin, installationId, email, jti: randomUUID(), iat, exp: iat + 300 });
    const owner = await initialize({ request, origin, token, claim: { path: '/auth/owner-claim', token: signed }, database: hosted.database, fixtures: createFixtureControl(new Set(surface.verification.network.origins)) });
    const cookie = owner.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
    await owner.body?.cancel();
    const db = await hosted.database('DB');
    // Seed private, realistic text through the native owner route, never SQL writes.
    const privateText = 'synthetic-dial-private <script>window.privateLeak=true</script> & "owner"';
    const saved = await request(origin + '/api/app/profile', { method: 'PATCH', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: 'synthetic-dial-owner', name: 'Avery Chen', title: 'Scheduling coordinator', biography: privateText, timezone: 'UTC', focusAreas: [], socialProof: [] }) });
    assert.equal(saved.status, 200); await saved.body?.cancel();
    const identity = await db.prepare("SELECT operator_id FROM operator_setup_identity WHERE singleton_key='default'").first();
    const settings = await signJws(pair.privateKey, kid, 'rer-business-settings+jwt', { v: 1, iss: issuer, aud: origin, sub: installationId, business: 'synthetic-dial-1', email, owner_id: identity.operator_id, jti: randomUUID(), iat, exp: iat + 300, rev: 1, values: {}, logo: null, team: null });
    const paired = await request(origin + '/api/rer/business-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }) });
    assert.equal(paired.status, 200); await paired.body?.cancel();
    const context = createProtocol({ fetch: request, origin, surface, signer: { issuer, installationId, kid, privateKey: pair.privateKey }, person: { email, cookie, sub: identity.operator_id }, business: 'synthetic-dial-1', consent: randomUUID(), agentId: 'synthetic-dial-2', seq: 0, revision: 0, points: [] });
    const snapshot = async () => {
      const tables = (await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
      const rows = {};
      for (const { name } of tables) rows[name] = (await db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()).results;
      return rows;
    };
    const pages = [];
    for (const [phase, policy] of [['autonomous', autonomousPolicy()], ['held', heldPolicy()]]) {
      await context.adopt(policy);
      const tools = await context.mcp('tools/list'), templates = await context.mcp('resources/templates/list');
      assert.equal(tools.status, 200); assert.equal(templates.status, 200);
      const expectedTools = tools.result.tools.map(tool => tool.name), expectedResources = templates.result.resourceTemplates.map(resource => resource.uriTemplate);
      assert.ok(expectedTools.length > 1, 'compare populated actual MCP metadata');
      assert.ok(expectedTools.includes('dial.events.list'), 'include the runtime built-in');
      const before = await snapshot(), callsBefore = providerCalls;
      for (const headers of [{}, { Cookie: cookie }, { Authorization: 'Bearer synthetic-dial-invalid' }]) {
        const response = await request(origin + '/docs/agents', { headers });
        assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html/);
        assert.equal(response.headers.get('set-cookie'), null);
        const html = await response.text();
        assert.deepEqual([...html.matchAll(/data-agent-tool="([^"]+)"/g)].map(match => match[1]), expectedTools, phase + ' tool names and order');
        assert.deepEqual([...html.matchAll(/data-agent-resource="([^"]+)"/g)].map(match => match[1]), expectedResources, phase + ' mounted resource names and order');
        assert.equal(html.includes(privateText), false); assert.equal(html.includes('synthetic-dial-private'), false);
        assert.equal(html.includes(cookie), false); assert.equal(html.includes(signed), false);
        assert.equal(html.includes('/native/'), false, 'prepared readers are not advertised');
        if (!Object.keys(headers).length) pages.push({ phase, html, expectedTools, expectedResources });
      }
      const head = await request(origin + '/docs/agents', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
      const refused = await request(origin + '/docs/agents', { method: 'POST' }); assert.equal(refused.status, 405); await refused.body?.cancel();
      assert.deepEqual(await snapshot(), before, 'documentation reads and refused writes change no native or outbox rows');
      assert.equal(providerCalls, callsBefore, 'no tool or provider execution');
    }
    // Preserve the existing docs and genuine unknown-slug recovery routes.
    const docs = await request(origin + '/docs'); assert.equal(docs.status, 200); assert.match(await docs.text(), /<h1[\s>]/);
    const unknown = await request(origin + '/docs/synthetic-dial-unknown'); assert.equal(unknown.status, 404); assert.match(await unknown.text(), /href="\/"/, 'unknown docs retain the native home recovery');
    const child = await request(origin + '/docs/agents/synthetic-dial-unknown'); assert.equal(child.status, 404); await child.body?.cancel();
    const systemChromium = await access('/usr/bin/chromium').then(() => '/usr/bin/chromium', () => undefined);
    browser = await chromium.launch({ headless: true, ...(systemChromium ? { executablePath: systemChromium } : {}), args: ['--no-sandbox', '--use-mock-keychain', '--password-store=basic'] });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const actual = pages[0];
    await browserContext.route(origin + '/**', async route => {
      assert.equal(new URL(route.request().url()).pathname, '/docs/agents', 'documentation needs no subrequests');
      const response = await request(route.request().url());
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await page.goto(origin + '/docs/agents');
      // Assertions run at desktop; mobile is the retained layout smoke and proof.
      if (width === 1440) {
        assert.deepEqual(await page.locator('[data-agent-tool]').evaluateAll(nodes => nodes.map(node => node.dataset.agentTool)), actual.expectedTools);
        assert.deepEqual(await page.locator('[data-agent-resource]').evaluateAll(nodes => nodes.map(node => node.dataset.agentResource)), actual.expectedResources);
        assert.equal(await page.locator('form,input,button,script').count(), 0, 'inventory is read-only');
        const violations = (await new AxeBuilder({ page }).analyze()).violations;
        assert.deepEqual(violations.map(item => ({ id: item.id, impact: item.impact })), []);
      }
      assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), 'no page overflow at ' + width);
      const path = evidencePath(`agent-documentation-${width}.png`); await mkdir(resolve(path, '..'), { recursive: true });
      await page.screenshot({ path, fullPage: true });
    }
    // Exercise the exact renderer with hostile registration metadata, keeping the
    // real production inventory above. This never mounts a test tool or service.
    const compiled = await build({ entryPoints: ['src/agent-door/documentation.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
    const { agentDocumentation } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
    const hostile = '<img src=x onerror="window.syntheticLeak=true"> & \'quoted\'';
    const escaped = await agentDocumentation(new Request(origin + '/docs/agents'), { name: hostile, specialist: hostile, tools: [{ name: hostile, title: hostile, description: hostile, scope: hostile, classes: [hostile] }], resourceTemplates: [{ name: hostile, uriTemplate: hostile, description: hostile }] }).text();
    await page.setContent(escaped);
    assert.equal(await page.locator('img,script').count(), 0); assert.equal(await page.evaluate(() => globalThis.syntheticLeak), undefined);
    assert.equal(await page.locator('[data-agent-tool]').getAttribute('data-agent-tool'), hostile);
    assert.equal(await page.locator('[data-agent-resource]').getAttribute('data-agent-resource'), hostile);
    assert.equal(await page.locator('h1').textContent(), 'Agent reference');
    assert.ok((await page.locator('main').textContent()).includes(hostile));
    assert.deepEqual(errors, []);
    assert.equal(providerCalls, 0);
    const receipt = { policies: pages.map(({ phase, expectedTools, expectedResources }) => ({ phase, tools: expectedTools, resourceTemplates: expectedResources })), widths: [1440, 390], databaseUnchanged: true, providerCalls, escapedMetadata: true, privateDataAbsent: true, cookiesSet: false, existingDocs: 200, unknownDocs: 404 };
    await writeFile(evidencePath('agent-documentation-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log('Agent documentation journey: both policies match live MCP ordering; read-only and escaped; desktop axe and both widths pass.');
    return receipt;
  } finally { await browser?.close(); await hosted.close(); }
}

export async function buildDocumentationWorker() {
  // Push test shards have no shared build artifact. Use the seed's real build.
  await new Promise((done, reject) => {
    const child = spawn('pnpm', ['run', 'build'], { stdio: 'inherit', env: process.env });
    child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(new Error('Production documentation build failed: ' + code)));
  });
}
