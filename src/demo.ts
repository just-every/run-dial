import { demoBookings, demoEventTypes, demoInvitees, demoProfile } from "../sample-data/dial-demo";
import { createServices } from "./core/app/services";
import type { AppBindings } from "./core/app/bindings";
import { BookingsRepository } from "./core/features/bookings/repository";
import { validateInvitee } from "./core/features/bookings/types";
import { datePlus, wallClockInstants, weekdayForDate } from "./core/features/availability/timezone";
import { createOpaqueToken, hashToken } from "./core/platform/auth/tokens";
import { parseRuntimeEnvironment } from "./core/shared/runtime-env";
import { hostDateToday } from "./core/shared/scheduling";

// Fixed booking ids (ULIDs), so a repeated seed finds its own bookings and adds nothing.
const bookingId = (index: number) => `01K7D3M0B00KS0000000000${String(index).padStart(3, "0")}`;
const derivedId = (index: number, kind: "C" | "T") => `01K7D3M0B00KS0000000${kind}00${String(index).padStart(3, "0")}`;

/** The host date `offset` working days from `today` (Saturday and Sunday are skipped). */
function workingDay(today: string, offset: number) {
  let date = today, left = Math.abs(offset);
  const step = offset < 0 ? -1 : 1;
  while (weekdayForDate(date) === 0 || weekdayForDate(date) === 6) date = datePlus(date, step);
  while (left > 0) {
    date = datePlus(date, step);
    if (weekdayForDate(date) !== 0 && weekdayForDate(date) !== 6) left -= 1;
  }
  return date;
}

/**
 * Demo mode's data (withDemo runs it once, after the owner exists): the owner's finished first run with Maya Chen's
 * profile, three published event types and a week of bookings with four invitees. It writes through Dial's own services
 * and repositories, sends no mail and makes no calendar request.
 */
export async function seedDemo(env: AppBindings, { now }: { ownerEmail: string; now: Date }) {
  // One-off hosted egress proof. This branch is deployed only to the disposable test host.
  let refused = false;
  try { await fetch("https://example.com/"); }
  catch (error) { refused = error instanceof TypeError && error.message.includes("demo mode sends nothing"); }
  if (!refused) throw new Error("Hosted demo public fetch was not refused by the app guard");
  const runtime = parseRuntimeEnvironment(env as unknown as Record<string, unknown>);
  const services = createServices(env.DB, runtime, env.ASSETS);
  const owner = await env.DB.prepare("SELECT id FROM oa_operators WHERE role = 'owner' AND status = 'active' ORDER BY created_at LIMIT 1").first<{ id: string }>();
  if (!owner) throw new Error("Demo data needs the owner");

  const profile = (await services.hostProfile.getProfile()) ?? await services.hostProfile.saveProfile(demoProfile);
  if (!profile) throw new Error("Demo profile was not saved");
  const existing = await services.eventTypes.listEventTypes();
  const events = [];
  for (const input of demoEventTypes) {
    let event = existing.find((item) => item.slug === input.slug) ?? await services.eventTypes.createEventType(input);
    if (event.status !== "published") {
      const published = await services.eventTypes.publishEventType(event.id);
      if (published.kind !== "published") throw new Error(`Demo event ${input.slug} was not published: ${JSON.stringify(published)}`);
      event = published.eventType;
    }
    events.push(event);
  }

  // The owner's first run ends the way the setup page ends it: the first link copied, then completion.
  const kickoff = events[0];
  if (!(await services.hostSetup.completion())) {
    const link = (await services.hostSetup.read()).links.find((item) => item.eventTypeId === kickoff.id);
    if (!link || (await services.hostSetup.reportCopy(kickoff.id, link.url)).kind !== "recorded") throw new Error("Demo booking link was not recorded");
    const completed = await services.hostSetup.complete();
    if (completed.kind !== "completed") throw new Error(`Demo first run was not completed: ${JSON.stringify(completed)}`);
  }

  const repository = new BookingsRepository(env.DB);
  const today = hostDateToday(profile.timezone, now);
  for (const [index, plan] of demoBookings.entries()) {
    const id = bookingId(index);
    if (await repository.getById(id)) continue;
    const event = events.find((item) => item.slug === plan.slug)!;
    const question = event.questions[0];
    const invitee = validateInvitee(event, { ...demoInvitees[plan.invitee], answers: plan.answer && question?.key ? { [question.key]: plan.answer } : {} });
    if (!invitee) throw new Error(`Demo invitee for booking ${index} is invalid`);
    const hostDate = workingDay(today, plan.day);
    const [start] = wallClockInstants(hostDate, plan.minute, profile.timezone);
    const startAt = start.toISOString(), endAt = new Date(start.getTime() + event.durationMinutes * 60_000).toISOString();
    const claimed = await repository.claimForOperator({
      bookingId: id, occurrenceId: derivedId(index, "C"), manageTokenId: derivedId(index, "T"), hostName: profile.name,
      manageTokenHash: await hashToken(createOpaqueToken(), runtime.SESSION_SECRET),
      manageTokenExpiresAt: new Date(start.getTime() + 90 * 86_400_000).toISOString(),
      event, invitee, selection: { startAt, endAt, inviteeTimezone: profile.timezone }, hostTimezone: profile.timezone, hostDate,
      occupiedStartAt: new Date(start.getTime() - event.beforeBufferMinutes * 60_000).toISOString(),
      occupiedEndAt: new Date(Date.parse(endAt) + event.afterBufferMinutes * 60_000).toISOString(),
      now: now.toISOString(), emails: [], calendarPayload: undefined,
    }, owner.id);
    if (claimed !== "claimed") throw new Error(`Demo booking ${index} was not saved: ${claimed}`);
  }
}
