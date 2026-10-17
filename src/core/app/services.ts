import { EventBookingPolicyRepository } from "../features/event-types/booking-policy-repository";
import { PersonErasure } from "../features/erasure/person";
import { NamedSchedules } from "../features/availability/named-schedules";
import { BookingLimits } from "../features/availability/booking-limits";
import { createCustomFields } from "./mount.server";
import { MoveInService, eraseImportedBooking } from "../features/move-in";
import type { SessionRecord } from "../features/operators";
import { installPublicOrigin } from "../shared/public-origin";
import { SwitchOverService } from "../features/move-in/switch-over";
import { HostSetupRepository } from "../features/host-setup/repository";
import { HostSetupService } from "../features/host-setup/service";
import { OperatorManagementRepository } from "../features/operators/management-repository";
import { DeliveryRecovery } from "../features/delivery";
import { ErasureRepository } from "../features/erasure";
import type { CalendarAdapter } from "../platform/calendar";
import type { MailSender } from "../platform/mail";
import type { CalendarExternalChangeHandler, ConnectionWatchObservers } from "../features/calendar-connection";
import { AvailabilityRepository, AvailabilityService } from "../features/availability";
import { AvailabilityRequestsRepository, AvailabilityRequestsService } from "../features/availability-requests";
import { BookingsRepository, BookingsService, CalendarDeletionProbesRepository } from "../features/bookings";
import { CalendarConnectionRepository, CalendarConnectionService } from "../features/calendar-connection";
import { DeliveryRepository, DeliveryPreferencesRepository, ProviderDeliveryService } from "../features/delivery";
import { EmbedsRepository, EmbedsService } from "../features/embeds";
import { EventTypesRepository, EventTypesService } from "../features/event-types";
import { HostProfileRepository } from "../features/host-profile/repository";
import { HostProfileService } from "../features/host-profile/service";
import { AvatarStorage } from "../features/host-profile/avatar-storage";
import { OperatorsService } from "../features/operators";
import { PublicAbuseRepository } from "../features/public-abuse";
import { createSpaSurface } from "../platform/assets/spa-surface";
import { SendGridWebhookReceiver } from "../features/delivery/sendgrid-webhook";
import { ResendMailSender } from "../platform/mail/resend";
import { suppressesMail } from "../platform/mail/development";
import { BaseMailSender, mailConfiguration } from "../platform/mail/base-mail";
import type { RuntimeEnvironment } from "../shared/runtime-env";

export function createServices(binding: D1Database, runtime: RuntimeEnvironment, assets: Fetcher, adapters: { files?: R2Bucket; calendar?: CalendarAdapter; mail?: MailSender; authMail?: import("../../../modules/operator-auth/index.mjs").MailSender; calendarChanges?: CalendarExternalChangeHandler; connectionWatch?: ConnectionWatchObservers } = {}) {
  const hostProfile = new HostProfileService(new HostProfileRepository(binding));
  const calendar = new CalendarConnectionService(new CalendarConnectionRepository(binding), runtime, adapters.calendar);
  const mailConfig = mailConfiguration(runtime);
  const mail = adapters.mail ?? ((suppressesMail(runtime) || mailConfig.provider === "sendgrid" || mailConfig.provider === "rer" || mailConfig.provider === "development") ? new BaseMailSender(binding, runtime)
    : new ResendMailSender(mailConfig.apiKey && mailConfig.from && (runtime.MAIL_PROVIDER === "resend" ? runtime.MAIL_WEBHOOK_KEY : runtime.RESEND_WEBHOOK_SECRET) ? { apiKey: mailConfig.apiKey, fromEmail: mailConfig.from } : undefined));
  const deliveryRepository = new DeliveryRepository(binding, mailConfig.provider, Boolean(runtime.MAIL_PROVIDER ? runtime.MAIL_WEBHOOK_KEY : runtime.RESEND_WEBHOOK_SECRET));
  const eventTypes = new EventTypesService(new EventTypesRepository(binding), hostProfile, { calendar, mail, recorded: { calendar: () => calendar.connectionHealth(), mail: () => deliveryRepository.mailHealth() } });
  const availability = new AvailabilityService(new AvailabilityRepository(binding), hostProfile, eventTypes, calendar);
  const bookings = new BookingsService(new BookingsRepository(binding), availability, hostProfile, eventTypes, runtime, {
    probes: new CalendarDeletionProbesRepository(binding), inspect: (input) => calendar.inspectManagedEvent(input),
  });
  calendar.setExternalChangeHandler(adapters.calendarChanges ?? bookings);
  if (adapters.connectionWatch) calendar.setWatchObservers(adapters.connectionWatch);
  const authMail = adapters.authMail ?? (adapters.mail ? { async send(message: import("../../../modules/operator-auth/index.mjs").MailMessage) {
    const result = await adapters.mail!.send({ to: message.to[0], subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}), idempotencyKey: message.deliveryId });
    return { status: "accepted" as const, provider: "edition", providerMessageId: result.providerMessageId };
  } } : undefined);
  const operators = new OperatorsService(binding, runtime, authMail);
  return {
    bookingPolicies: new EventBookingPolicyRepository(binding),
    namedSchedules: new NamedSchedules(binding),
    bookingLimits: new BookingLimits(binding),
    customFields: createCustomFields(binding),
    moveIn: new MoveInService(binding, runtime.SESSION_SECRET),
    switchOver: new SwitchOverService(binding, eventTypes, hostProfile, installPublicOrigin(runtime.APP_URL)),
    eraseImportedBooking: (id: string, session: SessionRecord) => eraseImportedBooking(binding, id, session, runtime.SESSION_SECRET),
    erasure: new ErasureRepository(binding, runtime.SESSION_SECRET),
    personErasure: new PersonErasure(binding, runtime.SESSION_SECRET),
    deliveryRecovery: new DeliveryRecovery(binding),
    deliveryPreferences: new DeliveryPreferencesRepository(binding),
    operatorManagement: new OperatorManagementRepository(binding, operators, runtime.SESSION_SECRET),
    operators,
    publicAbuse: new PublicAbuseRepository(binding),
    avatarStorage: new AvatarStorage(new HostProfileRepository(binding), adapters.files),
    hostProfile,
    hostSetup: new HostSetupService(new HostSetupRepository(binding), hostProfile, eventTypes, installPublicOrigin(runtime.APP_URL)),
    eventTypes,
    calendar,
    mail,
    sendgridWebhook: new SendGridWebhookReceiver(binding, runtime.MAIL_WEBHOOK_KEY),
    delivery: new ProviderDeliveryService(deliveryRepository, calendar, mail, runtime.MAIL_PROVIDER === "resend" ? runtime.MAIL_WEBHOOK_KEY : runtime.RESEND_WEBHOOK_SECRET, runtime.SESSION_SECRET),
    availability,
    bookings,
    availabilityRequests: new AvailabilityRequestsService(new AvailabilityRequestsRepository(binding), eventTypes, hostProfile, runtime),
    embeds: new EmbedsService(new EmbedsRepository(binding), eventTypes, hostProfile),
    spaSurface: createSpaSurface(assets),
  };
}

export type AppServices = ReturnType<typeof createServices>;
