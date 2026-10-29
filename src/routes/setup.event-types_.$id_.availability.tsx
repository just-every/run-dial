import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute('/setup/event-types_/$id_/availability')({
  beforeLoad: ({ params }) => { throw redirect({ to: "/setup/event-types/$id/hours", params: { id: params.id }, replace: true }); },
});
