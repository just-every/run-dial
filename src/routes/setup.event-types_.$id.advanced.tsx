import { createFileRoute } from "@tanstack/react-router";
import { EventAdvancedRoute } from "../core/features/event-types/ui/event-settings-routes";

export const Route = createFileRoute('/setup/event-types_/$id/advanced')({ component: EventAdvancedRoute });
