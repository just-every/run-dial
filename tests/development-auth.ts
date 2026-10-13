import { createD1DevelopmentOutbox } from "../modules/mail/src/development/index.mjs";

/** Test support reads only the capture created by this real Base issuance. */
export async function issuedDevelopmentLink(db: D1Database, email: string, issue: () => Promise<unknown>) {
  const outbox = createD1DevelopmentOutbox({ db });
  const before = new Set((await outbox.list()).map(capture => capture.id));
  await issue();
  const recipient = email.trim().toLowerCase();
  const current = (await outbox.list()).filter(capture => !before.has(capture.id)
    && capture.message.to.length === 1 && capture.message.to[0] === recipient);
  if (current.length > 1) throw new Error("Expected one current authentication capture");
  if (!current.length) return undefined;
  const links = current[0].message.text?.match(/https?:\/\/[^\s]+/g) ?? [];
  const link = links.find(value => new URL(value).pathname === "/auth/confirm");
  if (!link) throw new Error("Current authentication capture has no confirmation link");
  return link;
}
