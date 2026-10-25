import { createFileRoute } from "@tanstack/react-router";

// The parent keeps the list and its selected panel mounted while the address changes.
export const Route = createFileRoute('/app/requests/$id')({});
