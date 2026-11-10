import { mappingSource } from "./mapping";

/**
 * Parent-page script for a plain HTML form:
 *   <script src="https://DIAL/api/public/external-routing/dial-form.js"
 *     data-dial-form="#contact" data-dial-routing="ROUTING_FORM_ID"
 *     data-dial-map='[{"field":"topic","question":"purpose","prefill":"answer.q_goal"},{"field":"email","prefill":"email"}]'></script>
 * On submit it opens one named Dial handoff window and carries only the mapped values in
 * the URL fragment, which no server or referrer ever receives. The form's own submission is
 * never prevented. The window always opens on this script's own origin. The script reports
 * dial:routing-opened and dial:routing-refused (detail.code) on window.
 */
export const externalRoutingBootstrap = String.raw`(() => {
${mappingSource}
  const current = document.currentScript;
  const announce = (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail }));
  const boot = () => {
    const scripts = current ? [current] : Array.from(document.querySelectorAll('script[data-dial-routing][src*="/external-routing/dial-form.js"]'));
    scripts.forEach(script => {
      if (script.dataset.dialMounted) return;
      script.dataset.dialMounted = 'true';
      const routing = script.dataset.dialRouting || '';
      const refuse = code => announce('dial:routing-refused', { code });
      let form = null;
      try { form = script.dataset.dialForm ? document.querySelector(script.dataset.dialForm) : null; } catch { /* An invalid selector finds no form. */ }
      if (!(form instanceof HTMLFormElement)) return refuse('form_not_found');
      if (form.dataset.dialRoutingMounted) return;
      let map;
      try {
        if (!DIAL_FORM_ID.test(routing)) throw dialRefuse('invalid_map');
        map = dialParseMap(script.dataset.dialMap || '');
        for (const { field } of map) {
          const controls = Array.from(form.elements).filter(control => control.name === field);
          if (!controls.length || controls.some(control => control.type === 'password' || control.type === 'file')) throw dialRefuse('invalid_map');
        }
      } catch (error) { return refuse(error.code || 'invalid_map'); }
      form.dataset.dialRoutingMounted = 'true';
      const handoff = new URL('/api/public/external-routing/handoff', new URL(script.src, window.location.href).origin);
      form.addEventListener('submit', () => {
        let fragment;
        try {
          const data = new FormData(form);
          fragment = dialEncode(routing, dialResolve(map, field => data.getAll(field)));
        } catch (error) { return refuse(error.code || 'invalid_values'); }
        if (fragment.length > DIAL_LIMITS.fragment) return refuse('invalid_values');
        handoff.hash = fragment;
        // One named window per routing form: a repeated submit reuses it instead of opening another.
        if (window.open(handoff.href, 'dial-routing-' + routing)) announce('dial:routing-opened', { form: routing });
        else refuse('popup_blocked');
      });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
`;
