import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

/** Values a page left unsaved, beside the saved values they replace. */
export type Carried = { values: Record<string, unknown>; base: Record<string, unknown> };
/** A form that leaving must not lose: it saves what it holds first, or sends it with the page as the page goes. */
export type Leavable = { readonly key: string; readonly mounted: number; flush(): Promise<boolean>; sendOnHide(): Carried | undefined };

const forms = new Set<Leavable>();
const carriedKey = "dial:autosave-carried";
const carriedLifetime = 30 * 60 * 1000;
let signedOut = false;
let screens = 0;
let unblock: (() => void) | undefined;

/** Holds a form until it is saved and off screen; until then a page that goes sends its values with keepalive. */
export function guard(form: Leavable) {
  if (!forms.size) {
    addEventListener("pagehide", sendAll);
    addEventListener("dial:auth-lost", forget);
  }
  forms.add(form);
  return () => {
    forms.delete(form);
    if (forms.size) return;
    removeEventListener("pagehide", sendAll);
    removeEventListener("dial:auth-lost", forget);
  };
}

/**
 * The page is going: unsaved values go with keepalive, and also travel to this tab's next page, which may read the record
 * before that write lands (a reload asks for the next page first). Nothing travels once the owner has signed out.
 */
function sendAll() {
  const entries: Record<string, Carried> = {};
  for (const form of forms) {
    const carried = form.sendOnHide();
    if (carried) entries[form.key] = carried;
  }
  if (signedOut || !Object.keys(entries).length) return;
  try { sessionStorage.setItem(carriedKey, JSON.stringify({ at: Date.now(), entries })); } catch { /* Storage off: the keepalive write still goes. */ }
}

function forget() {
  signedOut = true;
  try { sessionStorage.removeItem(carriedKey); } catch { /* Nothing was carried. */ }
}

/** What the tab's last page left unsaved for one form, read once; older than half an hour, it is dropped. */
export function carriedFor(key: string): Carried | undefined {
  try {
    const stored = JSON.parse(sessionStorage.getItem(carriedKey) ?? "null") as { at: number; entries: Record<string, Carried> } | null;
    if (!stored?.entries?.[key]) return undefined;
    const { [key]: carried, ...rest } = stored.entries;
    if (Object.keys(rest).length && Date.now() - stored.at < carriedLifetime) sessionStorage.setItem(carriedKey, JSON.stringify({ ...stored, entries: rest }));
    else sessionStorage.removeItem(carriedKey);
    return Date.now() - stored.at < carriedLifetime ? carried : undefined;
  } catch { return undefined; }
}

/**
 * While a form is on screen, a navigation that leaves the page (its path changes, as when a sheet closes) waits for its
 * saves, and one that fails keeps the page. One that stays on the page (search, filters, paging, views) goes at once while
 * the saves go on: a form it takes off screen is held, and sent again when it is shown again.
 */
export function useLeaveGuard() {
  const { history } = useRouter();
  useEffect(() => {
    if (!screens++) unblock = history.block({ blockerFn: ({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && saveBeforeLeaving().then((saved) => !saved), enableBeforeUnload: false });
    return () => {
      if (--screens) return;
      unblock?.();
      unblock = undefined;
    };
  }, [history]);
}

/**
 * Saves every form before a page or a sheet closes. False when a form on screen could not save or waits for its confirm:
 * the first failure line or confirm then takes focus, so the reason the page stayed is in view.
 */
export async function saveBeforeLeaving() {
  const saved = await Promise.all([...forms].map(async (form) => (await form.flush()) || !form.mounted));
  if (saved.every(Boolean)) return true;
  requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-autosave-attention]")?.focus());
  return false;
}
