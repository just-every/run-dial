import { FeatureList, type Feature } from "./FeatureList";

const ownership: Feature[] = [
  { icon: "cloud", title: "Your Cloudflare account", text: "One Worker with its database, file storage and queues, on an account you own." },
  { icon: "download", title: "Export your data", text: "Every booking, answer and setting in a local install goes into one private archive." },
  { icon: "restore", title: "Restore it whole", text: "Import that archive into a fresh, empty install, with new sign-ins and nothing replayed." },
  { icon: "code", title: "Open source, MIT licensed", text: "Read the code and change anything, from the wording to the booking flow." },
];

/** Self-hosting and ownership: the account, the data and the source are the owner's. */
export function YoursToRun() {
  return <section className="column" id="yours" aria-labelledby="yours-title">
    <h2 id="yours-title" className="stacked"><span>Yours to run,</span> <span>yours to change.</span></h2>
    <p className="column-lede">Deploy Dial on your own Cloudflare account. You hold the data, the look and the code, and nothing phones home.</p>
    <FeatureList items={ownership} />
  </section>;
}
