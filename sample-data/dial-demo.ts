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

const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 }));

/** The demo's event types: the kickoff above on a video link (publishable without a connected calendar), and two more. */
export const demoEventTypes: EventTypeInput[] = [
  { ...demoEventType, locationType: "fixed_link", locationLabel: "Video call", locationValue: "https://meet.example.com/maya-chen", availability: weekdays },
  {
    ...demoEventType, slug: "roadmap-review", title: "Roadmap review", durationMinutes: 60, color: "#3b5bdb",
    description: "An hour working through your roadmap together: what to cut, what to sequence, and what to say no to.",
    locationType: "in_person", locationLabel: "In person", locationValue: "Level 2, 88 Ann Street, Brisbane", minimumNoticeMinutes: 1440, afterBufferMinutes: 15,
    questions: [{ kind: "text", label: "Link to the roadmap, if you have one", required: false, options: [] }],
    availability: [2, 4].map((weekday) => ({ weekday, startMinute: 600, endMinute: 960 })),
  },
  {
    ...demoEventType, slug: "office-hours", title: "Office hours", durationMinutes: 15, color: "#c2410c",
    description: "A quick question about a product decision, a hire or a launch.",
    locationType: "phone", locationLabel: "Phone call", locationValue: "+61 7 3000 0000", alternativeRequestsEnabled: false, minimumNoticeMinutes: 60,
    questions: [], availability: [{ weekday: 5, startMinute: 780, endMinute: 960 }],
  },
];

export const demoInvitees = [
  { name: "Priya Raman", email: "priya@northwind.example" },
  { name: "Tom Becker", email: "tom.becker@lumen.example" },
  { name: "Aiko Tanaka", email: "aiko@tanaka-studio.example" },
  { name: "Daniel Okafor", email: "daniel@okafor.example" },
];

/** A week of bookings around the demo's start: host weekday offset from today, host wall-clock minute, event slug, invitee and answer. */
export const demoBookings = [
  { day: -3, minute: 600, slug: "product-kickoff", invitee: 0, answer: "Deciding between two pricing pages for the launch." },
  { day: -2, minute: 660, slug: "roadmap-review", invitee: 1, answer: "https://docs.example/lumen-roadmap" },
  { day: -1, minute: 840, slug: "office-hours", invitee: 2 },
  { day: 0, minute: 570, slug: "product-kickoff", invitee: 3, answer: "We have three months of runway for one bet." },
  { day: 1, minute: 900, slug: "product-kickoff", invitee: 1, answer: "Follow-up on the roadmap cuts." },
  { day: 2, minute: 630, slug: "roadmap-review", invitee: 0 },
  { day: 3, minute: 810, slug: "office-hours", invitee: 3 },
  { day: 4, minute: 720, slug: "product-kickoff", invitee: 2, answer: "Planning the studio's first paid product." },
];
