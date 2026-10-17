import type { Confirmation } from "./types";

export type CommittedConfirmation = Confirmation & { bookingReference?: string; postBookingRedirectUrl?: string };

export function safePostBookingRedirect(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

/** Only the initial committed confirmation emits a conversion; receipt/manage reads never do. */
export function completeBooking(confirmation: CommittedConfirmation, embedded: boolean, search: string) {
  const redirectUrl = safePostBookingRedirect(confirmation.postBookingRedirectUrl);
  if (!embedded) {
    if (redirectUrl) { window.location.assign(redirectUrl); return true; }
    return false;
  }
  const parent = new URLSearchParams(search).get("parent");
  const bookingReference = confirmation.bookingReference;
  if (window.parent !== window && parent && bookingReference && /^[A-Za-z0-9_-]{1,160}$/.test(bookingReference)) {
    try {
      if (new URL(parent).origin === parent) window.parent.postMessage({ type: "dial:booked", bookingReference, ...(redirectUrl ? { redirectUrl } : {}) }, parent);
    } catch { /* The receipt remains available when the embedding parent is unavailable. */ }
  }
  return false;
}
