import type { MailAttachment, MailMessage } from "../../platform/mail";

export function toMailMessage(value: unknown, idempotencyKey: string): MailMessage | undefined {
  return isDirectMessage(value) ? { to: value.to, subject: value.subject, text: value.text, ...(value.html ? { html: value.html } : {}), ...(value.replyTo ? { replyTo: value.replyTo } : {}), ...(value.attachments ? { attachments: value.attachments } : {}), idempotencyKey } : undefined;
}

function isDirectMessage(value: unknown): value is Record<"to" | "subject" | "text", string> & { html?: string; replyTo?: string; attachments?: MailAttachment[] } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.to === "string" && candidate.to.trim().length > 0
    && typeof candidate.subject === "string" && candidate.subject.trim().length > 0
    && typeof candidate.text === "string" && candidate.text.trim().length > 0
    && (candidate.html === undefined || typeof candidate.html === "string")
    && (candidate.replyTo === undefined || typeof candidate.replyTo === "string")
    && (candidate.attachments === undefined || isAttachments(candidate.attachments));
}

function isAttachments(value: unknown): value is MailAttachment[] {
  return Array.isArray(value) && value.length <= 8 && value.every((attachment) => {
    if (!attachment || typeof attachment !== "object") return false;
    const item = attachment as Record<string, unknown>;
    return typeof item.filename === "string" && item.filename.length > 0 && item.filename.length <= 255
      && typeof item.contentBase64 === "string" && item.contentBase64.length > 0 && item.contentBase64.length <= 2_000_000 && isBase64(item.contentBase64)
      && (item.contentType === undefined || typeof item.contentType === "string");
  });
}

function isBase64(value: string) {
  try {
    atob(value);
    return true;
  } catch {
    return false;
  }
}
