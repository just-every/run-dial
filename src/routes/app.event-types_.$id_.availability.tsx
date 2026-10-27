import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute('/app/event-types_/$id_/availability')({
  beforeLoad: ({ params }) => { throw redirect({ to: "/app/event-types/$id/hours", params: { id: params.id }, replace: true }); },
});
