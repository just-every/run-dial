/** Sender checks reject the configured from-address before making a provider call. */
export function mailConnectionMessage(reason: string | null | undefined) {
  if (reason === "unauthorized") return "Mail credentials were refused. Update the mail settings and check again. For Managed hosting, rotate the mail credential in Run Edit Run, then rebuild and publish Dial";
  return reason === "invalid_delivery_payload"
    ? "Enter the sender as a full email address on your verified domain, for example hello@example.com"
    : reason;
}
