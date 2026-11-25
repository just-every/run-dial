/** Sender checks reject the configured from-address before making a provider call. */
export function mailConnectionMessage(reason: string | null | undefined) {
  if (reason === "unauthorized") return "Mail credentials were refused. Update the mail settings and check again. For Managed hosting, rotate the mail credential in Run Edit Run, then rebuild and publish Dial";
  if (reason === "mail_off") return "Outbound email is off for this deployment (MAIL_PROVIDER=none). Sign in with `rer signin`; turn mail on with `rer deploy` and a sender, a provider key and MAIL_PROVIDER";
  return reason === "invalid_delivery_payload"
    ? "Enter the sender as a full email address on your verified domain, for example hello@example.com"
    : reason;
}
