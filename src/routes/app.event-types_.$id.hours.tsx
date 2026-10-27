import { createFileRoute } from "@tanstack/react-router";
import { EventHoursRoute } from "../core/features/event-types/ui/event-settings-routes";

export const Route = createFileRoute('/app/event-types_/$id/hours')({ component: EventHoursRoute });
