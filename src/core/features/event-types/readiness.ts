export const readinessFixes = {
  host_profile: { label: "Save a host name, handle and valid timezone.", href: "/app/profile" },
  private_location: { label: "Choose and save a supported event location.", href: "event" },
  open_availability: { label: "Add at least one open availability window.", href: "availability" },
  transactional_mail: { label: "Verify the transactional mail sender.", href: "/app/settings#mail-connection" },
  destination_calendar: { label: "Connect and check a destination calendar.", href: "/app/settings#calendar-connection" },
  microsoft_teams_capability: { label: "Connect and check a Microsoft calendar with Teams capability.", href: "/app/settings#calendar-connection" },
  google_meet_capability: { label: "Choose a destination calendar with Google Meet capability.", href: "/app/settings#calendar-connection" },
  alternative_requests_enabled: { label: "Enable alternative requests for this event.", href: "event" },
  event_already_published: { label: "This event is public. Manage its current publication settings.", href: "event" },
  event_configuration_changed: { label: "Event settings changed during the check. Reload the saved event and check again.", href: "event" },
  event_not_found: { label: "Choose an existing event type.", href: "/app/event-types" },
} as const;

export function readinessFix(code: string, eventId?: string) {
  if (!Object.hasOwn(readinessFixes, code)) throw new Error(`Unknown publication requirement: ${code}`);
  const fix = readinessFixes[code as keyof typeof readinessFixes];
  return { label: fix.label, href: fix.href === "event" ? eventId ? `/app/event-types/${eventId}` : "/app/event-types" : fix.href === "availability" ? eventId ? `/app/event-types/${eventId}/availability` : "/app/availability" : fix.href };
}
