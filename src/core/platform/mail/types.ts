export type MailAttachment = {
  filename: string;
  contentBase64: string;
  contentType?: string;
};

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
  idempotencyKey: string;
};

export type MailSendResult = { providerMessageId: string | null };

export type MailConnectionCheck = { checkedAt: string };

export interface MailSender {
  checkConnection(): Promise<MailConnectionCheck>;
  send(message: MailMessage): Promise<MailSendResult>;
}
