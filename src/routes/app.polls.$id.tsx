import { createFileRoute } from "@tanstack/react-router";

// The parent keeps the poll list mounted while the address changes.
export const Route = createFileRoute('/app/polls/$id')({});
