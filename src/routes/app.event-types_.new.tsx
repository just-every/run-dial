import { createFileRoute } from "@tanstack/react-router";
import { NewEventSteps } from "../core/features/event-types/ui/new-event-steps";

export const Route = createFileRoute('/app/event-types_/new')({ codeSplitGroupings: [], component: () => <NewEventSteps workspace="/app" /> });
