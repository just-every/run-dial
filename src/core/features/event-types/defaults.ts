import type { EventQuestionInput, EventTypeInput } from "./repository";

/** Public question identity is scoped to its event type, including this default. */
export function defaultEventQuestions(): EventQuestionInput[] {
  return [{ key: "q_default_agenda", kind: "text", label: "Agenda", required: false, options: [] }];
}

export function defaultEventTypeInput(): EventTypeInput {
  return {
    slug: "", title: "", description: "", durationMinutes: 30, color: "#dcab3c",
    locationType: "fixed_link", locationLabel: "Fixed link", locationValue: "",
    listed: true, alternativeRequestsEnabled: true, slotIncrementMinutes: 15,
    minimumNoticeMinutes: 240, bookingHorizonDays: 60, beforeBufferMinutes: 0,
    afterBufferMinutes: 0, hostDayBookingLimit: null,
    questions: defaultEventQuestions(), availability: [],
  };
}
