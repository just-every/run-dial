import { mappingSource } from "./mapping";

export const handoffPath = "/api/public/external-routing/handoff";

export const handoffDocument = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>Opening your scheduling page</title>
<link rel="stylesheet" href="${handoffPath}.css">
</head>
<body>
<main>
<h1 id="title" tabindex="-1">Opening your scheduling page</h1>
<p id="detail" role="status" aria-live="polite">One moment while we find the right time for you.</p>
<p id="actions"></p>
</main>
<noscript><p class="noscript">JavaScript is needed to open your scheduling page. Return to the form and use its own confirmation.</p></noscript>
<script src="${handoffPath}.js" defer></script>
</body>
</html>
`;

export const handoffStyles = `*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4f1ea;color:#1d1c1a;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(520px,100%);padding:32px;border:1px solid #cfc8b8;border-radius:16px;background:#fffefa}
h1{margin:0 0 12px;font-size:1.5rem;line-height:1.25}
h1:focus{outline:none}
p{margin:0 0 12px;overflow-wrap:anywhere}
.noscript{width:min(520px,100%);margin:16px auto 0}
a.button,button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border:0;border-radius:10px;background:#176b5a;color:#fff;font:600 1rem system-ui,sans-serif;text-decoration:none;cursor:pointer}
a.button:focus-visible,button:focus-visible{outline:3px solid #0b3d33;outline-offset:3px}
ul{margin:0 0 12px;padding-left:20px}
@media(max-width:480px){body{padding:12px}main{padding:20px}}
`;

/**
 * The same-origin handoff. Its fragment is stripped at once and held, with the routing
 * capability, only in this tab's sessionStorage under one key. A reload or a repeated
 * handoff of the same payload therefore reuses the same capability, and the existing
 * routing door answers every replay with its one recorded submission. A payload that
 * differs (an edited form) starts a new attempt. The onward path is always a validated
 * /book/ path returned by the routing door; the capability never reaches any URL.
 */
export const handoffScript = String.raw`(() => {
${mappingSource}
  const STORE = 'dial-external-routing:v1', BOOK = /^\/book\/[a-z0-9-]{1,80}\/[a-z0-9-]{1,80}$/;
  const title = document.getElementById('title'), detail = document.getElementById('detail'), actions = document.getElementById('actions');
  try { window.opener = null; } catch { /* Already detached. */ }
  const read = () => { try { return JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch { return null; } };
  const write = record => { if (record) sessionStorage.setItem(STORE, JSON.stringify(record)); else sessionStorage.removeItem(STORE); };
  const hex = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  const show = (heading, message, { alert = false, list = [], action } = {}) => {
    title.textContent = heading; detail.textContent = message; detail.setAttribute('role', alert ? 'alert' : 'status');
    actions.replaceChildren(); document.querySelectorAll('[data-dial-list]').forEach(node => node.remove());
    if (list.length) { const items = document.createElement('ul'); list.forEach(text => { const item = document.createElement('li'); item.textContent = text; items.append(item); }); detail.after(items); items.dataset.dialList = 'true'; }
    if (action) { const control = document.createElement(action.href ? 'a' : 'button'); control.className = 'button'; control.textContent = action.label; if (action.href) control.href = action.href; else { control.type = 'button'; control.addEventListener('click', action.run); } actions.append(control); }
    title.focus();
  };
  const refusal = (heading, message, extra) => show(heading, message, { alert: true, ...extra });
  const gone = () => refusal('This link cannot be used', 'Return to the form you filled in and submit it again.');
  const retry = () => ({ label: 'Try again', run: () => run().catch(failed) });
  const failed = () => refusal('We could not reach the scheduling service', 'Nothing was booked. Please try again.', { action: retry() });
  const json = async response => { try { return await response.json(); } catch { return {}; } };

  async function prepare(record) {
    const response = await fetch('/api/public/routing/' + record.payload.form, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (response.status === 404) return refusal('This form is unavailable', 'Nothing was booked. Return to the form and contact the host directly.');
    if (!response.ok) return failed();
    const form = await response.json(), known = new Set(form.questions.map(question => question.key));
    if (Object.keys(record.payload.answers).some(key => !known.has(key))) return refusal('This form is not connected correctly', 'Its answers do not match the scheduling form, so nothing was sent. Contact the person who runs the form.');
    record.nonce = form.capability.nonce; record.stage = 'ready'; record.questions = Object.fromEntries(form.questions.map(question => [question.key, question.label]));
    write(record);
    return record;
  }

  async function run() {
    let record = read();
    if (!record) return refusal('Nothing to open', 'Return to the form you filled in and submit it again.');
    if (record.stage === 'done') return location.replace(record.target);
    if (record.stage === 'message') return show('Thank you', record.message);
    if (record.stage === 'new') { record = await prepare(record); if (!record) return; }
    const response = await fetch('/api/public/routing/' + record.payload.form + '/submit', { method: 'POST', headers: { 'content-type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ nonce: record.nonce, answers: record.payload.answers }), cache: 'no-store' });
    const body = await json(response);
    if (response.ok && typeof body.bookingPath === 'string' && BOOK.test(body.bookingPath)) {
      const query = dialBookingQuery(record.payload.prefill);
      const target = body.bookingPath + (query ? '?' + query : '');
      write({ key: record.key, stage: 'done', target });
      return location.replace(target);
    }
    if (response.ok && typeof body.message === 'string') {
      write({ key: record.key, stage: 'message', message: body.message });
      return show('Thank you', body.message);
    }
    const code = body.error && body.error.code;
    if (response.status === 400 && code === 'invalid_answers') {
      const labels = (body.error.details || []).map(key => (record.questions && record.questions[key]) || 'A required answer');
      return refusal('A few answers are still needed', 'Nothing was booked. Return to the form, complete these and submit again:', { list: labels });
    }
    if (response.status === 409 && code === 'routing_target_unavailable') return refusal('This scheduling page is not available', 'Nothing was booked. Please contact the host directly.', { action: retry() });
    if (response.status === 404 || response.status === 410) { write(null); return gone(); }
    return failed();
  }

  let starting = false;
  async function start() {
    const fragment = location.hash.slice(1);
    if (fragment) history.replaceState(null, '', location.pathname);
    if (fragment) {
      const record = read();
      let payload;
      try { payload = dialDecode(fragment); } catch { return refusal('This link cannot be used', 'It does not hold a valid form submission. Return to the form and submit it again.'); }
      const key = await hex(fragment);
      if (!record || record.key !== key) {
        write({ key, stage: 'new', payload });
        // An edited form arriving while another attempt runs restarts cleanly on the new payload.
        if (starting) return location.reload();
      } else if (starting) return;
    } else if (starting) return;
    starting = true;
    try { await run(); } catch { failed(); } finally { starting = false; }
  }
  window.addEventListener('hashchange', () => { start(); });
  start();
})();
`;
