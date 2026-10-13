import { Link } from "@tanstack/react-router";
import type { PublicProfile } from "../../../public-booking";
import { HeroDial } from "../drawings/HeroDial";
import { HostChip } from "./HostChip";

/** The first viewport: the dial clicking onto a time, then, with a host profile, its link first, the headline and both calls to action. */
export function Hero({ profile }: { profile?: PublicProfile }) {
  return <section className="hero" aria-labelledby="hero-title">
    <div className="hero-art"><HeroDial /></div>
    <div className="hero-copy">
      {profile ? <HostChip profile={profile} /> : null}
      <h1 id="hero-title" className="hero-title"><span>Pick a time.</span> <span>That’s it.</span></h1>
      <p className="lede">A booking page that checks your live calendar, speaks every timezone and never asks invitees to sign up. Open source, on your own Cloudflare account.</p>
      <p className="fine fine-alternative">100% free, open source alternative to <strong>Calendly</strong>, <strong>Acuity&nbsp;Scheduling</strong> and <strong>SavvyCal</strong></p>
      <div className="actions">
        <Link className="pill pill--lg" to="/docs/$slug" params={{ slug: "install" }}>Deploy your own</Link>
        <Link className="text-link" to="/docs">Read the docs</Link>
      </div>
      <p className="fine">Free and open source, MIT licensed.</p>
    </div>
  </section>;
}
