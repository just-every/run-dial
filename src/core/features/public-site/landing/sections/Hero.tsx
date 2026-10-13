import { HeroDial } from "../drawings/HeroDial";

/** The first viewport: the dial clicking onto a time, the approved headline and public calls to action. */
export function Hero() {
  return <section className="hero" aria-labelledby="hero-title">
    <div className="hero-art"><HeroDial /></div>
    <div className="hero-copy">
      <h1 id="hero-title" className="hero-title"><span>Pick a time.</span> <span>That’s it.</span></h1>
      <p className="lede">A booking page that checks your live calendar, speaks every timezone and never asks invitees to sign up. Open source, on your own Cloudflare account.</p>
      <p className="fine fine-alternative">100% free, open source alternative to <strong>Calendly</strong>, <strong>Acuity&nbsp;Scheduling</strong> and <strong>SavvyCal</strong></p>
      <div className="actions">
        <a className="pill pill--lg" href="/run">Run Dial</a>
        <a className="text-link" href="/docs">Read the docs</a>
      </div>
      <p className="fine">Free and open source, MIT licensed.</p>
    </div>
  </section>;
}
