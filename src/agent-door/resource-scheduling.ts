import type { AppServices } from "../core/app/services";
import { nativeResource, recordCount, resourceText } from "./resource-definition";

export function schedulingResources(services: AppServices) {
  return [
    nativeResource("hosts", "Host profile", async id => {
      const profile = await services.hostProfile.getProfile();
      if (!profile || profile.id !== id) return null;
      return {
        id: profile.id, handle: profile.handle, name: resourceText(profile.name), title: resourceText(profile.title),
        biography: resourceText(profile.biography), timezone: profile.timezone,
        focusAreas: profile.focusAreas.map(area => ({ label: resourceText(area.label) })),
        socialProof: profile.socialProof.map(proof => ({ quote: resourceText(proof.quote), attribution: resourceText(proof.attribution) })),
        createdAt: profile.createdAt, updatedAt: profile.updatedAt,
      };
    }, record => ({ kind: record.biography ? "host-profile-with-biography" : "host-profile" })),
    nativeResource("event-types", "Event type", async id => {
      const event = await services.eventTypes.getEventType(id);
      if (!event) return null;
      return {
        id: event.id, slug: event.slug, title: resourceText(event.title), description: resourceText(event.description), status: event.status,
        durationMinutes: event.durationMinutes, durationOptionsMinutes: event.durationOptionsMinutes,
        locationType: event.locationType, locationLabel: resourceText(event.locationLabel), listed: event.listed,
        alternativeRequestsEnabled: event.alternativeRequestsEnabled, slotIncrementMinutes: event.slotIncrementMinutes,
        minimumNoticeMinutes: event.minimumNoticeMinutes, bookingHorizonDays: event.bookingHorizonDays,
        bookingHorizonMode: event.bookingHorizonMode, bookingStartDate: event.bookingStartDate, bookingEndDate: event.bookingEndDate,
        beforeBufferMinutes: event.beforeBufferMinutes, afterBufferMinutes: event.afterBufferMinutes,
        hostDayBookingLimit: event.hostDayBookingLimit, availability: event.availability,
        questions: event.questions.map(question => ({
          key: question.key, kind: question.kind, label: resourceText(question.label), required: question.required, private: question.private,
          options: question.options.map(option => ({ value: resourceText(option.value), label: resourceText(option.label) })),
        })),
        createdAt: event.createdAt, updatedAt: event.updatedAt,
      };
    }, record => ({ kind: record.status === "published" && record.listed ? "published-event-type" : "private-event-type" })),
    nativeResource("schedules", "Availability schedule", async id => {
      const schedule = await services.namedSchedules.get(id);
      return schedule ? { ...schedule, name: resourceText(schedule.name) } : null;
    }, record => ({ kind: recordCount(record.timeOff) ? "availability-with-time-off" : "availability-schedule" })),
    nativeResource("requests", "Alternative time request", async id => {
      const request = await services.availabilityRequests.getForOperator(id);
      return request ? {
        ...request, eventTitle: resourceText(request.eventTitle), inviteeName: resourceText(request.inviteeName),
        note: request.note ? resourceText(request.note) : null,
      } : null;
    }, record => ({ kind: record.note ? "invitee-request-with-note" : "invitee-request" })),
    nativeResource("polls", "Meeting poll", async id => {
      const poll = await services.polls.host(id);
      if (!poll) return null;
      return {
        id: poll.id, eventTypeId: poll.eventTypeId, title: resourceText(poll.title), state: poll.state,
        closesAt: poll.closesAt, showTally: Boolean(poll.showTally), candidates: poll.candidates,
        participants: poll.participants.map(person => ({
          id: person.id, name: resourceText(person.name), email: person.email, revision: person.revision, votes: person.votes,
        })),
      };
    }, record => ({ kind: recordCount(record.participants) ? "poll-participants-and-votes" : "meeting-poll", records: Math.max(1, recordCount(record.participants)) })),
  ];
}
