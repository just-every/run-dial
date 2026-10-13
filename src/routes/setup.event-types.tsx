import { createFileRoute } from "@tanstack/react-router";
import { EventTypesPage } from "../core/features/event-types/ui/event-types-page";


export const Route = createFileRoute('/setup/event-types' )({ component: () => <EventTypesPage workspace="/setup" /> });

