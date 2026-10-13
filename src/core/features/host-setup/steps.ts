import type { HostSetupState } from "./service";

export type ConnectionStatus = { state: string; reason: string | null; checkedAt: string | null };
export function checkedHealthy(health: ConnectionStatus) {
  const age = health.checkedAt === null ? NaN : Date.now() - Date.parse(health.checkedAt);
  return health.state === "healthy" && Number.isFinite(age) && age >= 0 && age < 24 * 60 * 60 * 1000;
}

export function setupSteps(state: HostSetupState, calendar: ConnectionStatus, mail: ConnectionStatus) {
  const eventHref = state.eventTypeId ? `/app/event-types/${state.eventTypeId}` : "/app/event-types/new";
  return [
    { id: "profile", label: "Host profile", done: state.profileReady, href: "/app/profile" },
    { id: "mail", label: "Mail check", done: checkedHealthy(mail), href: "/app/settings#mail-connection" },
    { id: "calendar", label: "Google Calendar (optional)", done: checkedHealthy(calendar) || calendar.state === "disconnected", optional: calendar.state === "disconnected", href: "/app/settings#calendar-connection" },
    { id: "availability", label: "An availability window", done: state.availabilityReady, href: state.eventTypeId ? `${eventHref}/availability` : "/app/event-types/new" },
    { id: "event", label: "An event type", done: state.eventTypeId !== null, href: eventHref },
    { id: "publication", label: "Publish or Open requests", done: state.links.length > 0, href: eventHref },
    { id: "copy", label: "Copy the booking link", done: state.links.some((link) => link.copiedAt !== null), href: "/app/event-types" },
  ];
}

export type HostSetupOverview = HostSetupState & { calendar: ConnectionStatus; mail: ConnectionStatus; steps: ReturnType<typeof setupSteps> };
