export const demoProfile = {
  handle: "maya-chen",
  name: "Maya Chen",
  title: "Product strategy for independent teams",
  biography: "I help small teams make the next useful product decision with confidence.",
  timezone: "Australia/Brisbane",
  focusAreas: [{ label: "Product strategy" }, { label: "Roadmaps" }, { label: "Team rituals" }],
  socialProof: [],
};

export const demoEventType: EventTypeInput = {
  slug: "product-kickoff",
  title: "Product kickoff",
  description: "A focused conversation about the next product decision.",
  durationMinutes: 30,
  color: "#176b5a",
  locationType: "google_meet" as const,
  locationLabel: "Google Meet",
  locationValue: "",
  listed: true,
  alternativeRequestsEnabled: true,
  slotIncrementMinutes: 15,
  minimumNoticeMinutes: 240,
  bookingHorizonDays: 60,
  beforeBufferMinutes: 0,
  afterBufferMinutes: 0,
  hostDayBookingLimit: null,
  questions: [{ kind: "textarea" as const, label: "What would make this session useful?", required: false, options: [] }],
  availability: [
    { weekday: 1, startMinute: 540, endMinute: 1020 },
    { weekday: 2, startMinute: 540, endMinute: 1020 },
    { weekday: 3, startMinute: 540, endMinute: 1020 },
  ],
};
import type { EventTypeInput } from "../src/core/features/event-types/repository";
