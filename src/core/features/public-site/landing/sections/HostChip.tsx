import { Link } from "@tanstack/react-router";
import type { PublicProfile } from "../../../public-booking";

/** For a visitor who came to book: a compact chip above the headline linking to the host's public booking profile. */
export function HostChip({ profile }: { profile: PublicProfile }) {
  return <p className="host-chip">
    <span className="host-chip-dot" aria-hidden="true" />
    <span className="host-chip-lead">Here to book?</span>{" "}
    <Link className="host-chip-link" to="/book/$handle" params={{ handle: profile.handle }} reloadDocument><span>Book with {profile.name}<span aria-hidden="true"> →</span></span></Link>
  </p>;
}
