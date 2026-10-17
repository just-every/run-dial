import { templatedCalendar, templatedMail } from "./correspondence";
import { reminderMessage } from "./reminders";
import type { CalendarConnectionService } from "../calendar-connection";
import { ProviderFailure } from "../../platform/calendar";
import type { MailSender } from "../../platform/mail";
import { verifyResendWebhook } from "../../platform/mail";
import { z } from "zod";
import { toMailMessage } from "./email-content";
import { DeliveryRepository, type DeliveryOutboxRecord } from "./repository";
import type { AdmitCallback } from "../../platform/public-admission";
import { operatorNotificationCommand } from "../../platform/operator-notification-boundary";
import { isOperatorNotification } from "./operator-mail";
import { bookingCancellationMail, type BookingCancellationTemplate } from "./booking-mails";
import { escapeHtml, inviteeCalendarUrl, validateMailUrl } from "./branded-layout";
import { hashToken } from "../../platform/auth/tokens";

const retryDelaysMs = [60_000, 3 * 60_000, 8 * 60_000, 18 * 60_000, 30 * 60_000];

export const deliveryJobSchema = z.object({ outboxId: z.string().min(1).max(256) });
export type DeliveryJob = z.infer<typeof deliveryJobSchema>;
/** Queue implementations acknowledge with provider metadata which delivery does not need. */
export type DeliveryJobDispatcher = { send(job: DeliveryJob): Promise<unknown> };

export class ProviderDeliveryService {
  constructor(
    private readonly repository: DeliveryRepository,
    private readonly calendar: CalendarConnectionService,
    private readonly mail: MailSender,
    private readonly resendWebhookSecret: string | undefined,
    private readonly sessionSecret: string,
  ) {}

  async processDue(limit = 25, now = new Date()) {
    const ids = await this.repository.dueIds(now.toISOString(), limit);
    const results = await Promise.all(ids.map((id) => this.process({ outboxId: id }, now)));
    return { attempted: results.filter((result) => result !== "not_due").length, succeeded: results.filter((result) => result === "succeeded").length };
  }

  async enqueueDue(dispatcher: DeliveryJobDispatcher, limit = 25, now = new Date()) {
    const ids = await this.repository.dueIds(now.toISOString(), limit);
    await Promise.all(ids.map((outboxId) => dispatcher.send({ outboxId })));
    return { enqueued: ids.length };
  }

  async processUnknown(job: unknown, now = new Date()) {
    const parsed = deliveryJobSchema.safeParse(job);
    if (!parsed.success) throw new ProviderFailure("invalid_delivery_payload", false);
    return this.process(parsed.data, now);
  }

  async process(job: DeliveryJob, now = new Date()): Promise<"succeeded" | "retrying" | "failed" | "not_due"> {
    const record = await this.repository.claim(job.outboxId, now.toISOString());
    if (!record) return "not_due";
    try {
      const providerMessageId = await this.execute(record, now);
      await this.repository.succeeded(record, providerMessageId);
      return "succeeded";
    } catch (error) {
      const failure = asProviderFailure(error);
      const backoff = retryDelaysMs[record.attempts - 1];
      const delay = backoff === undefined ? undefined : Math.max(backoff, (failure.retryAfterSeconds ?? 0) * 1000);
      const retryable = failure.retryable && delay !== undefined;
      if (failure.code === "unauthorized" && ["mail_send", "reminder"].includes(record.kind)) await this.repository.setMailHealth("unhealthy", failure.code);
      await this.repository.failed(record, {
        retryable,
        errorCode: failure.code,
        nextAttemptAt: retryable ? new Date(now.getTime() + delay).toISOString() : undefined,
      });
      return retryable ? "retrying" : "failed";
    }
  }

  /**
   * The one-minute scheduled pass. A calendar failure it sees is only handed to the confirmation check
   * (NOTIFY-007), which alerts if the failure persists; recoveries and mail transitions are recorded here.
   */
  async reconcileConnections() {
    return this.reconcile({ confirming: false });
  }

  /** NOTIFY-007's confirmation check: a calendar that still fails is alerted once for the incident. */
  async confirmConnections() {
    return this.reconcile({ confirming: true });
  }

  private async reconcile({ confirming }: { confirming: boolean }) {
    // A connection that read healthy at the check before this one ended its incident, so a failure a confirmation sees
    // now is a new sighting with its own confirmation already scheduled, never the alert for the incident that cleared.
    const before = (await this.calendar.connectionHealth()).state;
    const [calendar, mail] = await Promise.all([this.calendar.checkConnection(), this.checkMailConnectionInternal()]);
    const calendarHealth = await this.calendar.connectionHealth();
    if (calendarHealth.state !== "disconnected") {
      const status = calendarHealth.state === "healthy" ? "healthy" : "unhealthy";
      const unconfirmed = status === "unhealthy" && (confirming ? before === "healthy" : await this.repository.connectionStatus("google_calendar") !== "unhealthy");
      if (unconfirmed) {
        if (!confirming) await this.calendar.requestConfirmation();
      } else {
        const transition = await this.repository.setConnectionHealth("google_calendar", status, calendarHealth.reason);
        if (transition.changed) await this.repository.enqueueConnectionAlert({ provider: "google_calendar", status, reason: calendarHealth.reason, alertCycle: transition.alertCycle });
      }
    }
    if (mail.transition.changed) await this.repository.enqueueConnectionAlert({
      provider: this.repository.mailProvider,
      status: mail.kind === "healthy" ? "healthy" : "unhealthy",
      reason: mail.kind === "unavailable" ? mail.code : null,
      alertCycle: mail.transition.alertCycle,
    });
    return { calendar, mail };
  }

  async renewCalendarChannels() {
    return this.calendar.renewExpiringPushChannels();
  }

  async receiveResendWebhook(request: Request, admit: AdmitCallback) {
    const payload = await request.text();
    const verified = await verifyResendWebhook(payload, request.headers, this.resendWebhookSecret);
    if (!verified) return { kind: "unauthorized" as const };
    const admission = await admit();
    if (admission.kind === "limited") return { kind: "rate_limited" as const, retryAfterSeconds: admission.retryAfterSeconds };
    const event = parseResendEvent(payload);
    if (!event) return { kind: "ignored" as const };
    const providerEventId = request.headers.get("svix-id")!;
    const recorded = await this.repository.recordWebhook({ providerEventId, occurredAt: event.createdAt, providerMessageId: event.providerMessageId });
    if (!recorded) return { kind: "duplicate" as const };
    if (event.type === "email.bounced" || event.type === "email.failed" || event.type === "email.complained") {
      if (event.providerMessageId) await this.repository.markProviderMessageFailed(event.providerMessageId, event.type === "email.bounced" ? "bounced" : "permanent_delivery_failure");
      await this.repository.completeWebhook(providerEventId, "processed");
      return { kind: "accepted" as const };
    }
    // Inbound mail is intentionally discarded: Dial has no inbound mail workflow.
    await this.repository.completeWebhook(providerEventId, event.type === "email.received" ? "ignored" : "processed");
    return { kind: "accepted" as const };
  }

  async mailHealth() {
    return this.repository.mailHealth();
  }

  /** Runs the provider's sender-domain check and persists the resulting health. */
  async checkMailConnection() {
    return this.checkMailConnectionInternal();
  }

  private async execute(record: DeliveryOutboxRecord, now: Date) {
    let payload = parsePayload(record.payloadJson);
    if (record.kind === "calendar_upsert") {
      if (await this.repository.calendarCommandState(record) !== "current") return undefined;
      if (record.bookingId) payload = { ...payload, lockedTimezone: await this.repository.calendarPresentationZone(record.bookingId) };
      const event = templatedCalendar(calendarEventFrom(payload, record), record.bookingId && record.occurrenceId ? await this.repository.correspondence(record.bookingId, record.occurrenceId) : undefined);
      const result = await this.calendar.upsertManagedEvent(event);
      const delivered = await this.repository.markCalendarDelivered(record, result);
      if (delivered.meetingFailed) throw new ProviderFailure("meeting_creation_failed", false);
      return result.providerEventId;
    }
    if (record.kind === "calendar_cancel") {
      if (!record.bookingId) throw new ProviderFailure("invalid_delivery_payload", false);
      if (await this.repository.calendarCommandState(record) !== "current") return undefined;
      await this.calendar.cancelManagedEvent(record.bookingId);
      await this.repository.markCalendarCancelled(record);
      return undefined;
    }
    if (record.kind === "reminder") {
      const booking = await this.repository.reminderBooking(record, now.toISOString());
      if (!booking) throw new ProviderFailure("superseded_occurrence", false);
      const reminder = reminderMessage(booking, payload);
      if (!reminder) throw new ProviderFailure("invalid_delivery_payload", false);
      payload = { ...payload, ...reminder };
    }
    if (record.kind === "mail_send" && !await this.repository.currentBookingMail(record, payload.bookingState === "cancelled", payload.messageKind === "host_contact")) throw new ProviderFailure("superseded_occurrence", false);
    const providerKey = string(payload.providerIdempotencyKey) ?? record.idempotencyKey;
    // Freeze the exact provider bytes before the effect. An ambiguous explicit
    // retry retains both those bytes and the original provider identity.
    const frozen = isRecord(payload.wireMail) ? payload.wireMail : undefined;
    if (!frozen && payload.mailTemplate !== undefined) {
      const template = bookingCancellationTemplate(payload.mailTemplate);
      if (!template || (payload.recipientRole !== "invitee" && payload.recipientRole !== "operator")) throw new ProviderFailure("invalid_delivery_payload", false);
      const snapshot = await this.repository.cancellationMailSnapshot(record);
      if (!snapshot) throw new ProviderFailure("invalid_delivery_payload", false);
      payload = {
        ...payload,
        ...bookingCancellationMail({
          ...snapshot,
          hostName: template.hostName,
          calendarState: snapshot.calendarState,
          actor: template.actor,
          reason: template.reason,
          recipientRole: payload.recipientRole,
        }),
      };
    }
    if (!frozen && payload.recipientRole === "invitee" && typeof payload.manageUrl === "string") {
      const manageUrl = await this.currentInviteeManageUrl(record, now);
      payload.manageUrl = manageUrl;
      refreshInviteeManageLinks(payload, manageUrl);
    }
    if (!frozen && payload.recipientRole === "invitee" && record.bookingId && record.occurrenceId) {
      const kind = record.kind === "reminder" ? "reminder" : payload.messageKind;
      if (kind === "confirmation" || kind === "reschedule" || kind === "cancellation" || kind === "reminder") {
        const data = await this.repository.correspondence(record.bookingId, record.occurrenceId);
        if (data) payload = templatedMail(payload, kind, data, await this.currentInviteeManageUrl(record, now));
      }
    }
    const message = toMailMessage(frozen ?? payload, providerKey);
    if (!message) throw new ProviderFailure("invalid_delivery_payload", false);
    if (await this.repository.operatorMailRevoked(record)) throw new ProviderFailure("operator_removed", false);
    if (isOperatorBookingMail(record, payload) && await this.repository.bookingMailMuted(message.to)) return undefined;
    if (!frozen) await this.repository.freezeMail(record, message, payload.recipientRole === "invitee" && typeof payload.manageUrl === "string" ? payload.manageUrl : undefined);
    if (isOperatorNotification(record, payload)) {
      return operatorNotificationCommand<string | null>("send", { outboxId: record.id, attempt: record.attempts });
    }
    return (await this.mail.send(message)).providerMessageId;
  }

  private async currentInviteeManageUrl(record: DeliveryOutboxRecord, now: Date) {
    const capability = await this.repository.currentInviteeManageCapability(record, now.toISOString());
    if (!capability) throw new ProviderFailure("invalid_delivery_payload", false);
    for (const candidate of capability.manageUrls) {
      try {
        const manageUrl = validateMailUrl(candidate);
        const parsed = new URL(manageUrl);
        const match = /^\/manage\/([^/]+)\/?$/u.exec(parsed.pathname);
        if (!match || parsed.search || parsed.hash) continue;
        if (await hashToken(match[1], this.sessionSecret) === capability.tokenHash) return manageUrl;
      } catch {
        // An invalid stored candidate cannot authorize a message; other current rows may still hold the active URL.
      }
    }
    throw new ProviderFailure("invalid_delivery_payload", false);
  }

  private async checkMailConnectionInternal() {
    try {
      const result = await this.mail.checkConnection();
      const transition = await this.repository.setMailHealth("healthy", null);
      return { kind: "healthy" as const, checkedAt: result.checkedAt, transition };
    } catch (error) {
      const failure = asProviderFailure(error);
      const transition = await this.repository.setMailHealth("unhealthy", failure.code);
      return { kind: "unavailable" as const, code: failure.code, transition };
    }
  }
}

function calendarEventFrom(payload: Record<string, unknown>, record: DeliveryOutboxRecord) {
  const invitee = isRecord(payload.invitee) ? payload.invitee : undefined;
  const eventTitle = string(payload.eventTitle);
  const startAt = string(payload.startAt);
  const endAt = string(payload.endAt);
  const timeZone = string(payload.lockedTimezone) ?? string(payload.hostTimezone);
  const inviteeName = string(invitee?.name);
  const inviteeEmail = string(invitee?.email);
  const location = string(payload.location);
  const icalUid = string(payload.icalUid);
  const requestGoogleMeet = payload.locationType === "google_meet";
  if (!eventTitle || !startAt || !endAt || !timeZone || !inviteeName || !inviteeEmail || (!location && !requestGoogleMeet) || !record.occurrenceId || !record.bookingId || !icalUid) {
    throw new ProviderFailure("invalid_delivery_payload", false);
  }
  return {
    idempotencyKey: record.idempotencyKey,
    bookingId: record.bookingId,
    occurrenceId: record.occurrenceId,
    icalUid,
    title: eventTitle,
    description: `Dial booking with ${inviteeName}`,
    location: location ?? "Google Meet",
    startAt,
    endAt,
    timeZone,
    inviteeEmail,
    requestGoogleMeet,
  };
}

function parsePayload(value: string) {
  try {
    const payload: unknown = JSON.parse(value);
    if (!isRecord(payload)) throw new Error("Expected an object");
    return payload;
  } catch {
    throw new ProviderFailure("invalid_delivery_payload", false);
  }
}

function parseResendEvent(payload: string): { type: string; providerMessageId?: string; createdAt?: string } | undefined {
  try {
    const value: unknown = JSON.parse(payload);
    if (!isRecord(value) || typeof value.type !== "string") return undefined;
    const data = isRecord(value.data) ? value.data : undefined;
    return {
      type: value.type,
      providerMessageId: typeof data?.email_id === "string" ? data.email_id : undefined,
      createdAt: typeof value.created_at === "string" ? value.created_at : undefined,
    };
  } catch {
    return undefined;
  }
}


function asProviderFailure(error: unknown) {
  return error instanceof ProviderFailure ? error : new ProviderFailure("internal_error", false);
}

function bookingCancellationTemplate(value: unknown): BookingCancellationTemplate | undefined {
  if (!isRecord(value) || value.kind !== "booking-cancellation" || typeof value.hostName !== "string" || typeof value.actor !== "string") return undefined;
  if (value.reason !== undefined && typeof value.reason !== "string") return undefined;
  return { kind: "booking-cancellation", hostName: value.hostName, actor: value.actor, ...(typeof value.reason === "string" ? { reason: value.reason } : {}) };
}

function refreshInviteeManageLinks(payload: Record<string, unknown>, manageUrl: string) {
  let calendarUrl: string;
  try {
    validateMailUrl(manageUrl);
    calendarUrl = inviteeCalendarUrl(manageUrl);
  } catch {
    throw new ProviderFailure("invalid_delivery_payload", false);
  }
  if (typeof payload.text === "string") {
    const text = replaceLastActionLine(payload.text, "Manage this booking", manageUrl);
    payload.text = replaceLastActionLine(text, "Add to calendar", calendarUrl);
  }
  if (typeof payload.html === "string") {
    const html = refreshActionHref(payload.html, "Manage booking", manageUrl);
    payload.html = refreshActionHref(html, "Add to calendar", calendarUrl);
  }
}

function replaceLastActionLine(text: string, label: string, href: string) {
  const lines = text.split("\n");
  const prefix = `${label}: `;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].startsWith(prefix)) {
      lines[index] = `${prefix}${href}`;
      break;
    }
  }
  return lines.join("\n");
}

function refreshActionHref(html: string, label: string, href: string) {
  const safeHref = escapeHtml(validateMailUrl(href));
  return html.replace(/<a\b([^>]*)>([^<]*)<\/a>/gu, (anchor, attributes: string, content: string) => {
    if (content !== label || !/\bhref="[^"]*"/u.test(attributes)) return anchor;
    return `<a${attributes.replace(/\bhref="[^"]*"/u, `href="${safeHref}"`)}>${content}</a>`;
  });
}

function isOperatorBookingMail(record: DeliveryOutboxRecord, payload: Record<string, unknown>) {
  return payload.messageKind !== "host_contact" && record.bookingId !== null && (record.kind === "mail_send" || record.kind === "reminder") && payload.recipientRole === "operator";
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
