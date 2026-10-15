// Paid mail edge for native tests. The application never captures dev/demo mail.
import { createD1DevelopmentOutbox } from "../modules/mail/src/development/index.mjs";
import type { MailSender as AuthMailSender } from "../modules/operator-auth/index.mjs";
import type { MailSender } from "../src/core/platform/mail";

export function captureMail(db: D1Database): MailSender {
  return {
    async checkConnection() { return { checkedAt: new Date().toISOString() }; },
    async send(message) {
      await createD1DevelopmentOutbox({ db }).put({ deliveryId: message.idempotencyKey, from: "noreply@dial.test", to: [message.to], subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}) });
      return { providerMessageId: `test-${message.idempotencyKey}` };
    },
  };
}
export async function capturedMail(db: D1Database) {
  return Response.json(await createD1DevelopmentOutbox({ db }).list());
}

export function captureAuthMail(db: D1Database): AuthMailSender {
  return { async send(message) {
    await createD1DevelopmentOutbox({ db }).put(message);
    return { status: "accepted", provider: "test", providerMessageId: `test-${message.deliveryId}` };
  } };
}
