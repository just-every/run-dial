import { Link } from "@tanstack/react-router";
import { MiniDial } from "../../../shared/drawing/MiniDial";
import { PublicFooter, PublicHeader, PublicTheme } from "./public-shell";

export function PublicRecoveryPage({ kind = "unavailable" }: { kind?: "unavailable" | "booking" | "manage" | "not-found" }) {
  const copy = recoveryCopy[kind];
  return <PublicTheme><PublicHeader /><main className="pb-recovery"><section><MiniDial state="off" className="mini-dial pb-recovery-mark" /><p className="pb-eyebrow">Dial</p><h1>{copy.title}</h1><p>{copy.description}</p><Link className="pb-primary-link" to="/" reloadDocument>Return to the home page <span aria-hidden="true">→</span></Link></section></main><PublicFooter /></PublicTheme>;
}

const recoveryCopy = {
  unavailable: { title: "This scheduling page is unavailable.", description: "It may have moved or is no longer open for booking." },
  booking: { title: "This booking step is unavailable.", description: "Open a current scheduling page to begin again." },
  manage: { title: "This manage link is unavailable.", description: "Ask the host for a current booking link if you need to make a change." },
  "not-found": { title: "We couldn’t find that page.", description: "Use the home page to find an available scheduling profile." },
};
