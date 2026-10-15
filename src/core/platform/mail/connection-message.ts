/** Sender checks reject the configured from-address before making a provider call. */
export function mailConnectionMessage(reason: string | null | undefined) {
  return reason === "invalid_delivery_payload"
    ? "Use a noreply@ or no-reply@ sender address on your verified domain, for example no-reply@example.com"
    : reason;
}
