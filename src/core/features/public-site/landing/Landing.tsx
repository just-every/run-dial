import { SiteFrame } from "../chrome";
import { AskAnotherTime } from "./sections/AskAnotherTime";
import { CheckedForYou } from "./sections/CheckedForYou";
import { Closing } from "./sections/Closing";
import { Essentials } from "./sections/Essentials";
import { Hero } from "./sections/Hero";
import { Invitees } from "./sections/Invitees";
import { YoursToRun } from "./sections/YoursToRun";
import { useHomeProfile } from "./useHomeProfile";
import "./styles";

/**
 * HOME-001. The public landing at `/`: what Dial is, for invitees and for hosts, in the public site's header and footer, with a
 * link to the host's booking profile when one is configured. It reads only that public profile, sets no cookie and loads only
 * same-origin resources; every drawing is inline and decorative, and the page reads the same without script or motion.
 */
export function Landing() {
  const profile = useHomeProfile();
  return <SiteFrame page="landing" className="dial-landing dial-art" skipTo="landing-content">
    <main id="landing-content" tabIndex={-1}>
      <Hero profile={profile} />
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
