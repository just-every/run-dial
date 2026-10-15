import type { Answers } from "./answer-retention";

type Draft = { handle: string; slug: string; expiresAt: number; name: string; email: string; answers: Answers };
const key = "dial:booking-recovery";
const lifetime = 30 * 60 * 1000;
let expiryTimer: number | undefined;

/** One event's refused details, private to this tab. Never supplies booking authority. */
export function rememberRecoveryDraft(handle: string, slug: string, details: Pick<Draft, "name" | "email" | "answers">) {
  try {
    const draft = { handle, slug, expiresAt: Date.now() + lifetime, ...details };
    window.sessionStorage.setItem(key, JSON.stringify(draft));
    expireDraft(draft);
    return true;
  } catch { return false; }
}

export function readRecoveryDraft(handle: string, slug: string) {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
    if (!validDraft(value)) { window.sessionStorage.removeItem(key); window.clearTimeout(expiryTimer); return undefined; }
    expireDraft(value);
    return value.handle === handle && value.slug === slug ? value : undefined;
  } catch { return undefined; }
}

export function forgetRecoveryDraft(handle: string, slug: string) {
  if (readRecoveryDraft(handle, slug)) {
    try { window.sessionStorage.removeItem(key); window.clearTimeout(expiryTimer); } catch { /* Storage can be disabled after a draft was read. */ }
  }
}

function expireDraft(draft: Draft) {
  window.clearTimeout(expiryTimer);
  expiryTimer = window.setTimeout(() => { readRecoveryDraft(draft.handle, draft.slug); }, Math.max(0, draft.expiresAt - Date.now()) + 1);
}

function validDraft(value: unknown): value is Draft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<Draft>;
  return typeof draft.handle === "string" && typeof draft.slug === "string"
    && typeof draft.expiresAt === "number" && draft.expiresAt > Date.now() && draft.expiresAt <= Date.now() + lifetime
    && typeof draft.name === "string" && draft.name.length <= 160 && typeof draft.email === "string" && draft.email.length <= 320
    && Boolean(draft.answers) && typeof draft.answers === "object" && !Array.isArray(draft.answers)
    && Object.values(draft.answers!).every(answer => typeof answer === "string" || Array.isArray(answer) && answer.every(item => typeof item === "string"));
}
