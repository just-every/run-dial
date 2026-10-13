import { renderBrandedMail } from "./branded-layout";

export function connectionAlertMail(providerName: string, status: "healthy" | "unhealthy", reason: string | null) {
  const subject = `${providerName} connection ${status === "healthy" ? "recovered" : "needs attention"}`;
  const text = status === "healthy"
    ? `${providerName} has recovered. Public scheduling can use this connection again.`
    : `${providerName} is unavailable (${reason ?? "connection check failed"}). Reconnect or correct the provider configuration in Settings; public scheduling fails closed until it recovers.`;
  return { subject, text, html: renderBrandedMail({ heading: subject, paragraphs: [text] }) };
}
