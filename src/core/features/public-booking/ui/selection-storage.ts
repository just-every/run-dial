import type { BookingDetailsCapability, PublicSelection } from "./selection-types";

const key = (handle: string, slug: string) => `dial:booking-selection:${encodeURIComponent(handle)}:${encodeURIComponent(slug)}`;

/** Mirror only server-issued progress. The URL and a fresh server lookup remain authoritative. */
export function rememberSelection(handle: string, slug: string, selected: PublicSelection) {
  const progress = { nonce: selected.nonce, startAt: selected.selection.startAt, inviteeTimezone: selected.selection.inviteeTimezone, expiresAt: selected.expiresAt };
  try { window.sessionStorage.setItem(key(handle, slug), JSON.stringify(progress)); }
  catch { /* Storage restrictions must not interrupt the server-authorized URL flow. */ }
}

/** A refused old URL must not erase a newer selection for the same event. */
export function forgetSelection(handle: string, slug: string, capability: BookingDetailsCapability) {
  try {
    const saved: unknown = JSON.parse(window.sessionStorage.getItem(key(handle, slug)) ?? "null");
    if (typeof saved !== "object" || saved === null) return;
    if ("nonce" in saved && saved.nonce === capability.nonce && "startAt" in saved && saved.startAt === capability.startAt
      && "inviteeTimezone" in saved && saved.inviteeTimezone === capability.inviteeTimezone) window.sessionStorage.removeItem(key(handle, slug));
  } catch { /* Unreadable browser storage never supplies booking authority. */ }
}
