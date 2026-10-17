import type { EventQuestionInput, EventTypeInput } from "./repository";

/** Public question identity is scoped to its event type, including this default. */
export function defaultEventQuestions(): (EventQuestionInput & { private: boolean })[] {
  return [{ key: "q_default_agenda", kind: "text", label: "Agenda", required: false, private: false, options: [] }];
}

export function defaultEventTypeInput(): EventTypeInput {
  return {
    slug: "", title: "", description: "", durationMinutes: 30, durationOptionsMinutes: [30], color: "#dcab3c",
    locationType: "fixed_link", locationLabel: "Fixed link", locationValue: "",
    listed: true, alternativeRequestsEnabled: true, slotIncrementMinutes: 15,
    minimumNoticeMinutes: 240, bookingHorizonDays: 60, bookingHorizonMode: "calendar_days", bookingStartDate: null, bookingEndDate: null, beforeBufferMinutes: 0,
    afterBufferMinutes: 0, hostDayBookingLimit: null,
    postBookingRedirect: null,
    questions: defaultEventQuestions(), availability: [],
  };
}
