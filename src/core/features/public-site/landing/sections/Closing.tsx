import { ClosingArt } from "../drawings/ClosingArt";

/** The closing call: the headline, both actions again, and the dial at rest. */
export function Closing() {
  return <section className="closing" aria-labelledby="closing-title">
    <div className="closing-copy">
      <h2 id="closing-title" className="stacked"><span>Give people</span> <span>a time that works.</span></h2>
      <p>Open source, built for real calendars, and yours to run on your own Cloudflare account.</p>
    </div>
    <div className="actions closing-actions">
      <a className="pill pill--lg" href="/run">Run Dial</a>
      <a className="text-link" href="/docs">Read the docs</a>
    </div>
    <ClosingArt />
  </section>;
}
