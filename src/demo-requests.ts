import type { AppServices } from "./core/app/services";
import { datePlus } from "./core/features/availability/timezone";
import { demoInvitees, demoProfile } from "../sample-data/dial-demo";

/** Populate the inbox through the same review and submission flow invitees use. */
export async function seedDemoRequests(services: AppServices, today: string) {
  const existing = await services.availabilityRequests.listForOperator();
  for (const [index, note] of [
    "Could we find a morning next week to review our launch plan?",
    "Our team is in a workshop during your regular hours. Would an afternoon work?",
  ].entries()) {
    const invitee = demoInvitees[index];
    if (existing.some(request => request.inviteeEmail === invitee.email && request.note === note)) continue;
    const composition = {
      inviteeName: invitee.name, inviteeEmail: invitee.email, inviteeTimezone: demoProfile.timezone, note,
      windows: [{ date: datePlus(today, 7 + index), startMinute: index ? 900 : 600, endMinute: index ? 960 : 660 }],
    };
    const review = await services.availabilityRequests.issueReview(demoProfile.handle, "product-kickoff", composition);
    if (review.kind !== "issued") throw new Error(`Demo request review failed: ${review.kind}`);
    const submitted = await services.availabilityRequests.submit(demoProfile.handle, "product-kickoff", review.review.nonce, composition);
    if (submitted.kind !== "created") throw new Error(`Demo request failed: ${submitted.kind}`);
  }
  // Demo mail uses the normal delivery path and is silently suppressed by Base.
  await services.delivery.processDue();
}
