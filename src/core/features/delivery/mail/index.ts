// Pure composition is a separate public entry point from Worker delivery.
// Repositories may build messages without importing runtime dispatch bindings.
export { bookingCancellationMail, bookingChangeHtml, bookingConfirmationMail, bookingLinkReadyMail, formatTimeRange } from "../booking-mails";
export type { BookingCancellationTemplate } from "../booking-mails";
export { requestSubmissionMail, requestUpdateMail } from "../request-mails";
export { operatorRecipientAdmission } from "../operator-mail";
export { renderBrandedMail } from "../branded-layout";
