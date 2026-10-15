/** Sender checks reject the configured from-address before making a provider call. */
export function mailConnectionMessage(reason: string | null | undefined) {
  return reason === "invalid_delivery_payload"
    ? "Enter the sender as a full email address on your verified domain, for example hello@example.com"
    : reason;
}
