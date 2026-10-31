import { createFileRoute } from "@tanstack/react-router";

// The parent keeps the client list mounted while the address changes.
export const Route = createFileRoute('/app/clients/$email')({});
