/**
 * Self-contained async embed bootstrap. Prefills are supplied in the script src query:
 * name (160 chars), email (320), answer.<questionKey> (repeat for multiple choice,
 * up to 25 keys / 50 values per key / 4000 chars per value), and utm_source,
 * utm_medium, utm_campaign, utm_term, utm_content or source (500 chars each).
 * Only these bounded fields are copied to the iframe; data attributes retain their
 * existing handle, event slug and inline/modal meanings. Values never verify identity.
 */
export const embedBootstrap = String.raw`(() => {
  const current = document.currentScript;
  const booked = new Set();
  const routingViews = new Set(), routingSubmissions = new Set();
  const boot = () => {
    const scripts = current ? [current] : Array.from(document.querySelectorAll('script[data-dial-embed][src*="/embed/dial.js"]'));
    scripts.forEach(script => {
      if (script.dataset.dialMounted) return;
      const handle = script.dataset.dialHandle, slug = script.dataset.dialEmbed, mode = script.dataset.dialMode || 'inline', routing = script.dataset.dialRouting === 'true';
      if ((!routing && !handle) || !slug || !['inline', 'modal'].includes(mode)) return;
      script.dataset.dialMounted = 'true';
      const scriptUrl = new URL(script.src, window.location.href), source = scriptUrl.origin;
      const query = new URLSearchParams(), answerKeys = new Map();
      const limits = { name: 160, email: 320, utm_source: 500, utm_medium: 500, utm_campaign: 500, utm_term: 500, utm_content: 500, source: 500 };
      for (const [key, value] of scriptUrl.searchParams) {
        if (key === 'gclid' || key === 'li_fat_id') {
          if (/^[A-Za-z0-9_.~-]{1,500}$/.test(value) && !query.has(key)) query.set(key, value);
          continue;
        }
        if (routing && /^[A-Za-z0-9_-]{1,80}$/.test(key) && value.length <= 4000 && query.size < 50 && !query.has(key)) query.set(key, value);
        if (Object.hasOwn(limits, key) && value.length <= limits[key] && !query.has(key)) query.set(key, value);
        if (!/^answer\.[A-Za-z0-9_-]{1,100}$/.test(key) || value.length > 4000) continue;
        if (!answerKeys.has(key) && answerKeys.size >= 25) continue;
        const values = answerKeys.get(key) || new Set();
        if (values.size < 50 && !values.has(value)) { values.add(value); query.append(key, value); }
        answerKeys.set(key, values);
      }
      const frames = new Set();
      window.addEventListener('message', message => {
        if (message.origin !== source || !Array.from(frames).some(f => f.contentWindow === message.source)) return;
        const data = message.data;
        if (!data || typeof data !== 'object') return;
        if (routing && data.type === 'dial:routing-viewed') {
          if (data.slug !== slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80 || routingViews.has(slug)) return;
          routingViews.add(slug);
          window.dispatchEvent(new CustomEvent('dial:routing-viewed', { detail: { slug } }));
          return;
        }
        if (routing && data.type === 'dial:routing-submitted') {
          if (typeof data.submissionReference !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(data.submissionReference) || routingSubmissions.has(data.submissionReference)) return;
          routingSubmissions.add(data.submissionReference);
          window.dispatchEvent(new CustomEvent('dial:routing-submitted', { detail: { submissionReference: data.submissionReference } }));
          return;
        }
        if (data.type !== 'dial:booked' || typeof data.bookingReference !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(data.bookingReference) || booked.has(data.bookingReference)) return;
        let redirectUrl;
        if (typeof data.redirectUrl === 'string') {
          try { const url = new URL(data.redirectUrl); if (url.protocol === 'https:' && !url.username && !url.password) redirectUrl = url.href; } catch { /* Invalid redirects never navigate. */ }
        }
        booked.add(data.bookingReference);
        window.dispatchEvent(new CustomEvent('dial:booked', { detail: { bookingReference: data.bookingReference } }));
        if (redirectUrl) window.location.assign(redirectUrl);
      });
      const frame = () => {
        const f = document.createElement('iframe'), parent = window.location.origin;
        const url = new URL('/embed/' + (routing ? 'route' : encodeURIComponent(handle)) + '/' + encodeURIComponent(slug) + (routing ? '/form' : ''), source);
        url.search = query.toString(); url.searchParams.set('parent', parent); url.hash = 'dial-parent=' + encodeURIComponent(parent);
        f.src = url.href; f.referrerPolicy = 'no-referrer'; f.title = (routing ? 'Complete ' : 'Book ') + slug; f.loading = 'lazy';
        f.style.cssText = 'width:100%;min-height:680px;border:0;background:transparent';
        frames.add(f); return f;
      };
      if (mode === 'inline') { script.insertAdjacentElement('afterend', frame()); return; }
      Array.from(document.querySelectorAll('[data-dial-embed]')).filter(trigger => trigger !== script && trigger.getAttribute('data-dial-embed') === slug).forEach(trigger => {
        const open = event => {
          event.preventDefault();
          const shell = document.createElement('div'), card = document.createElement('div'), close = document.createElement('button'), origin = document.activeElement, f = frame();
          let dismiss;
          const keydown = e => {
            if (e.key === 'Escape') { e.preventDefault(); dismiss(); return; }
            if (e.key === 'Tab') {
              const items = Array.from(shell.querySelectorAll('button,[href],iframe')).filter(item => !item.hasAttribute('disabled'));
              if (!items.length) return;
              const first = items[0], last = items[items.length - 1];
              if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
              else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
          };
          dismiss = () => { document.removeEventListener('keydown', keydown); frames.delete(f); shell.remove(); if (origin instanceof HTMLElement) origin.focus(); };
          shell.setAttribute('role', 'dialog'); shell.setAttribute('aria-modal', 'true'); shell.setAttribute('aria-label', 'Schedule a time');
          shell.style.cssText = 'position:fixed;z-index:2147483647;inset:0;padding:24px;display:grid;place-items:center;background:rgba(8,36,31,.48)';
          card.style.cssText = 'position:relative;width:min(760px,100%);max-height:100%;overflow:auto;background:#fffefa;border-radius:18px';
          close.type = 'button'; close.textContent = 'Close'; close.setAttribute('aria-label', 'Close scheduling window');
          close.style.cssText = 'position:absolute;right:10px;top:10px;z-index:1;min-height:44px;padding:0 12px;border:0;border-radius:8px;background:#fff;color:#1d1c1a;font:600 14px system-ui';
          close.addEventListener('click', dismiss); shell.addEventListener('click', e => { if (e.target === shell) dismiss(); }); document.addEventListener('keydown', keydown);
          card.append(close, f); shell.append(card); document.body.append(shell); close.focus();
        };
        trigger.addEventListener('click', open);
        if (!(trigger instanceof HTMLButtonElement || trigger instanceof HTMLAnchorElement)) {
          trigger.setAttribute('role', 'button'); trigger.tabIndex = 0;
          trigger.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger.click(); } });
        }
      });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();`;
