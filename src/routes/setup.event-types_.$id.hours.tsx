import { createFileRoute } from "@tanstack/react-router";
import { EventHoursRoute } from "../core/features/event-types/ui/event-settings-routes";
import { EventHours } from "../core/features/availability/ui/event-hours";

export const Route = createFileRoute('/setup/event-types_/$id/hours')({ component: HoursRoute });
function HoursRoute() {
  const { id } = Route.useParams();
  return <EventHoursRoute><EventHours eventId={id} /></EventHoursRoute>;
}
