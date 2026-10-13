import { SiteFrame } from "../chrome";
import { AskAnotherTime } from "./sections/AskAnotherTime";
import { CheckedForYou } from "./sections/CheckedForYou";
import { Closing } from "./sections/Closing";
import { Essentials } from "./sections/Essentials";
import { Hero } from "./sections/Hero";
import { Invitees } from "./sections/Invitees";
import { YoursToRun } from "./sections/YoursToRun";
import type { SiteVariant } from "../chrome/context";
import "./styles";

/**
 * HOME-001 adoption. The run site's approved marketing page, with public navigation and no installation data.
 * Resources stay same-origin; every drawing is inline and decorative, and the page reads the same without script or motion.
 */
export function Landing({ variant = "site" }: { variant?: SiteVariant }) {
  return <SiteFrame variant={variant} page="landing" className="dial-landing dial-art" skipTo="landing-content">
    <main id="landing-content" tabIndex={-1}>
      <Hero />
      <Invitees />
      <CheckedForYou />
      <div className="columns">
        <Essentials />
        <AskAnotherTime />
        <YoursToRun />
      </div>
      <Closing />
    </main>
  </SiteFrame>;
}
