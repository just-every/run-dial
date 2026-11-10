/**
 * The explicit field map and the bounded handoff payload, shared by the parent-page
 * bootstrap and the Dial handoff document as one browser source string.
 *
 * A map is a JSON array of {field, question?, prefill?}:
 *   field     the external form control name (1-100 characters)
 *   question  the routing-form question key that receives its value (at most one field each)
 *   prefill   the booking-page suggestion it also fills: name, email, utm_source,
 *             utm_medium, utm_campaign, utm_term, utm_content, source or answer.<key>
 * Nothing outside the map ever leaves the external form. The resolved payload is
 * {form, answers, prefill}; the handoff re-validates it against Dial's own routing form,
 * so a hand-built payload gains no more than the public routing doors already allow.
 * Values over a bound are refused, never truncated. Prefill values never verify identity.
 */
export const mappingSource = String.raw`
const DIAL_FORM_ID = /^[0-9A-Z]{26}$/, DIAL_FIELD = /^[A-Za-z0-9_.:\[\]-]{1,100}$/, DIAL_QUESTION = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const DIAL_ANSWER_KEY = /^answer\.[A-Za-z0-9_-]{1,100}$/;
const DIAL_SINGLE = { name: 160, email: 320, utm_source: 500, utm_medium: 500, utm_campaign: 500, utm_term: 500, utm_content: 500, source: 500 };
const DIAL_LIMITS = { questions: 30, answer: 2000, answerKeys: 25, answerValues: 50, answerValue: 4000, fragment: 65536 };
const dialRefuse = code => Object.assign(new Error(code), { code });
const dialPrefillKey = key => Object.hasOwn(DIAL_SINGLE, key) || DIAL_ANSWER_KEY.test(key);

function dialParseMap(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw dialRefuse('invalid_map'); }
  if (!Array.isArray(raw) || !raw.length || raw.length > DIAL_LIMITS.questions + DIAL_LIMITS.answerKeys + Object.keys(DIAL_SINGLE).length) throw dialRefuse('invalid_map');
  const fields = new Set(), questions = new Set(), prefills = new Set();
  return raw.map(entry => {
    const known = entry && typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry).every(key => ['field', 'question', 'prefill'].includes(key));
    if (!known || typeof entry.field !== 'string' || !DIAL_FIELD.test(entry.field) || fields.has(entry.field)) throw dialRefuse('invalid_map');
    const { question, prefill } = entry;
    if (question === undefined && prefill === undefined) throw dialRefuse('invalid_map');
    if (question !== undefined && (typeof question !== 'string' || !DIAL_QUESTION.test(question) || questions.has(question))) throw dialRefuse('invalid_map');
    if (prefill !== undefined && (typeof prefill !== 'string' || !dialPrefillKey(prefill) || prefills.has(prefill))) throw dialRefuse('invalid_map');
    fields.add(entry.field); if (question !== undefined) questions.add(question); if (prefill !== undefined) prefills.add(prefill);
    return { field: entry.field, question, prefill };
  });
}

/** valuesOf(field) returns the submitted string values of one control; a non-string value refuses the whole handoff. */
function dialResolve(map, valuesOf) {
  const answers = {}, prefill = {};
  for (const { field, question, prefill: target } of map) {
    const values = valuesOf(field);
    if (!values.every(value => typeof value === 'string')) throw dialRefuse('invalid_values');
    const kept = values.filter(value => value.trim());
    if (!kept.length) continue;
    if (question !== undefined) {
      if (kept.length !== 1 || kept[0].length > DIAL_LIMITS.answer) throw dialRefuse('invalid_values');
      answers[question] = kept[0];
    }
    if (target === undefined) continue;
    if (Object.hasOwn(DIAL_SINGLE, target)) {
      if (kept.length !== 1 || kept[0].length > DIAL_SINGLE[target]) throw dialRefuse('invalid_values');
      prefill[target] = kept[0];
    } else {
      if (kept.length > DIAL_LIMITS.answerValues || kept.some(value => value.length > DIAL_LIMITS.answerValue)) throw dialRefuse('invalid_values');
      prefill[target] = kept;
    }
  }
  return { answers, prefill };
}

const dialBase64 = {
  encode(text) { let binary = ''; new TextEncoder().encode(text).forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  decode(text) { const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0))); },
};

function dialEncode(form, resolved) { return 'v1.' + dialBase64.encode(JSON.stringify({ form, answers: resolved.answers, prefill: resolved.prefill })); }

/** The handoff trusts nothing in its fragment: every key, type and bound is checked again here. */
function dialDecode(fragment) {
  if (typeof fragment !== 'string' || fragment.length > DIAL_LIMITS.fragment || !fragment.startsWith('v1.') || !/^[A-Za-z0-9_-]+$/.test(fragment.slice(3))) throw dialRefuse('invalid_payload');
  let payload;
  try { payload = JSON.parse(dialBase64.decode(fragment.slice(3))); } catch { throw dialRefuse('invalid_payload'); }
  const plain = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!plain(payload) || !DIAL_FORM_ID.test(payload.form) || !plain(payload.answers) || !plain(payload.prefill)) throw dialRefuse('invalid_payload');
  const answers = Object.entries(payload.answers), prefill = Object.entries(payload.prefill);
  if (answers.length > DIAL_LIMITS.questions || answers.some(([key, value]) => !DIAL_QUESTION.test(key) || typeof value !== 'string' || !value.trim() || value.length > DIAL_LIMITS.answer)) throw dialRefuse('invalid_payload');
  const answerKeys = prefill.filter(([key]) => !Object.hasOwn(DIAL_SINGLE, key));
  if (answerKeys.length > DIAL_LIMITS.answerKeys) throw dialRefuse('invalid_payload');
  for (const [key, value] of prefill) {
    if (!dialPrefillKey(key)) throw dialRefuse('invalid_payload');
    if (Object.hasOwn(DIAL_SINGLE, key) ? typeof value !== 'string' || !value.trim() || value.length > DIAL_SINGLE[key]
      : !Array.isArray(value) || !value.length || value.length > DIAL_LIMITS.answerValues || value.some(item => typeof item !== 'string' || !item.trim() || item.length > DIAL_LIMITS.answerValue)) throw dialRefuse('invalid_payload');
  }
  return { form: payload.form, answers: Object.fromEntries(answers), prefill: Object.fromEntries(prefill) };
}

/** Only bounded LINK-003 fields reach the booking page; the routing answers themselves are not copied there. */
function dialBookingQuery(prefill) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(prefill)) for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  return query.toString();
}
`;
