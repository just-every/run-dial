type TrackingHealth = { provider: "sendgrid" | "resend" | "rer" | "development"; eventTracking: "on" | "off" | "not_applicable" };

export function MailTracking({ health }: { health?: TrackingHealth }) {
  if (!health || health.eventTracking === "not_applicable") return null;
  return <p className="mt-3 text-sm leading-6 text-soft">{health.eventTracking === "on"
    ? "Delivery and bounce tracking is on. Provider callbacks must pass signature verification."
    : health.provider === "sendgrid"
      ? <>Delivery and bounce tracking is off. Sending mail still works after a successful sender check. Add the signed Event Webhook verification key as MAIL_WEBHOOK_KEY using the <a className="underline underline-offset-4" href="https://github.com/just-every/run-dial/blob/main/docs/calendar-and-email.md#optional-delivery-and-bounce-tracking" target="_blank" rel="noreferrer">delivery tracking setup guide</a>, then reload Settings.</>
      : "Delivery and bounce tracking is off. Add your Resend webhook signing secret to the deployed Worker’s mail configuration, then check the sender and reload Settings."}</p>;
}
