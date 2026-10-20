type BookingDetailsSearch = { nonce?: string; startAt?: string; inviteeTimezone?: string; parent?: string };
type BookingConfirmationSearch = { token?: string; parent?: string };

export function bookingDetailsSearch(search: Record<string, unknown>): BookingDetailsSearch {
  return {
    nonce: stringSearch(search, "nonce"),
    startAt: stringSearch(search, "startAt"),
    inviteeTimezone: stringSearch(search, "inviteeTimezone"),
    parent: stringSearch(search, "parent"),
  };
}

export function bookingConfirmationSearch(search: Record<string, unknown>): BookingConfirmationSearch {
  return { token: stringSearch(search, "token"), parent: stringSearch(search, "parent") };
}

/** PAY-001's return page reads its payment-return capability only; Stripe's session_id is ignored. */
export function paymentReturnSearch(search: Record<string, unknown>): { return?: string } {
  return { return: stringSearch(search, "return") };
}

export function detailsCapability(search: BookingDetailsSearch) {
  return search.nonce && search.startAt && search.inviteeTimezone
    ? { nonce: search.nonce, startAt: search.startAt, inviteeTimezone: search.inviteeTimezone }
    : undefined;
}

function stringSearch(search: Record<string, unknown>, key: string) {
  const value = search[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
