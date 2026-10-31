import { Link } from "@tanstack/react-router";
import { EmptyState } from "../../../app/ui/empty-state";
import { buttonClassName } from "../../../app/ui/primitives";

const lists = { booking: "bookings", request: "requests", "event type": "event types", client: "clients", poll: "meeting polls" } as const;

export function RecordNotFound({ kind, back }: { kind: keyof typeof lists; back: "/app/bookings" | "/app/requests" | "/app/event-types" | "/app/clients" | "/app/polls" }) {
  return <EmptyState title={`${kind[0].toUpperCase()}${kind.slice(1)} not found`} description="This record may have been removed, or the address may be incomplete." action={<Link to={back} className={buttonClassName()}>Back to {lists[kind]}</Link>} />;
}

export function AppNotFound() {
  return <EmptyState title="Page not found" description="This address does not match a page in Dial." action={<Link to="/app" className={buttonClassName()}>Back to overview</Link>} />;
}
