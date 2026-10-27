import { createFileRoute } from "@tanstack/react-router";
import { NewEventSteps } from "../core/features/event-types/ui/new-event-steps";

export const Route = createFileRoute('/setup/event-types_/new')({ codeSplitGroupings: [], component: () => <NewEventSteps workspace="/setup" /> });
