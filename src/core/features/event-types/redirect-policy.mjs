/** Named public values only; never interpret a field as an arbitrary object path. */
export const redirectFields = ["event", "start_time", "end_time", "timezone", "host", "name", "email", "booking_reference", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "source"];

export function redirectUrlIssue(value) {
  if (typeof value !== "string" || /\s/u.test(value) || value.includes("\\") || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || !/^https:\/\//iu.test(value)) return "Enter an absolute HTTPS redirect URL.";
  let url;
  try { url = new globalThis.URL(value); } catch { return "Enter an absolute HTTPS redirect URL."; }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return "The redirect URL must use HTTPS and cannot contain credentials.";
  const unsafeName = /token|nonce|secret|password|credential|signature|authorization|session|cookie|payment|cardnumber|cardcvc|cardcvv|manage|^auth$|^key$|^code$/u;
  for (const key of [...url.searchParams.keys(), ...new globalThis.URLSearchParams(url.hash.slice(1)).keys()]) {
    if (/^answer\.q_[A-Za-z0-9_-]{10,80}$/u.test(key)) continue;
    if (/^answer\.q_[A-Za-z0-9_-]{10,80}$/u.test(key)) continue;
    if (unsafeName.test(key.toLowerCase().replace(/[^a-z0-9]/gu, ""))) return "The redirect URL contains an unsafe or capability parameter name.";
  }
  return null;
}

/** Questions are supplied at save time; runtime dispatch independently checks privacy. */
export function redirectConfigIssue(value, questions) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["url", "fields"].includes(key))) return { path: [], message: "Choose a redirect URL and named booking fields." };
  if (typeof value.url === "string" && value.url.length > 4096) return { path: ["url"], message: "The redirect URL cannot exceed 4096 characters." };
  const urlIssue = redirectUrlIssue(value.url);
  if (urlIssue) return { path: ["url"], message: urlIssue };
  if (!Array.isArray(value.fields) || value.fields.length > redirectFields.length + 25 || new Set(value.fields).size !== value.fields.length) return { path: ["fields"], message: "Choose distinct named booking fields." };
  for (const [index, field] of value.fields.entries()) {
    if (typeof field !== "string" || (!redirectFields.includes(field) && !/^answer\.q_[A-Za-z0-9_-]{10,80}$/u.test(field))) return { path: ["fields", index], message: "Choose a named booking field or an individual question." };
    if (field.startsWith("answer.") && questions && !questions.some(question => question.key === field.slice(7) && !question.private)) return { path: ["fields", index], message: "Choose an existing question that is not excluded from redirects." };
  }
  return null;
}
