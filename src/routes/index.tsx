import { createFileRoute, redirect } from "@tanstack/react-router";
/** HOME-001 adoption: the Worker owns the shared installed Lobby at /. */
export const Route = createFileRoute("/")({
  beforeLoad: () => { throw redirect({ href: "/", reloadDocument: true }); },
});
