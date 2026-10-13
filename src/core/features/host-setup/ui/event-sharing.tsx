import { Fragment, useState } from "react";
import { Button, Card } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { embedSnippet } from "../../embeds";
import { CopyBookingLink } from "./copy-booking-link";
import { useHostSetup } from "./use-host-setup";

export function EventSharing({ eventId, workspace = "/app" }: { eventId: string; workspace?: "/app" | "/setup" }) {
  const { state, error } = useHostSetup();
  const [notice, setNotice] = useState("");
  const link = state?.links.find((candidate) => candidate.eventTypeId === eventId);
  async function copy(mode: "inline" | "modal") {
    if (!link || !state) return;
    const [, , handle, slug] = new URL(link.url).pathname.split("/");
    try { await navigator.clipboard.writeText(embedSnippet(state.publicOrigin, handle, slug, mode)); setNotice(`${mode === "inline" ? "Inline" : "Modal"} embed copied.`); }
    catch { setNotice("The embed could not be copied. Allow clipboard access and try again."); }
  }
  return <Card className="p-5 sm:p-6"><SectionHeading icon="link" title="Share this event" />{error ? <p role="alert">{error}</p> : link ? <><p className="my-3 font-mono text-[13px] leading-6 [overflow-wrap:anywhere]"><a href={link.url} className="text-ink underline decoration-[1.5px] underline-offset-4 hover:decoration-gold-deep"><BreakableUrl url={link.url} /></a></p><CopyBookingLink link={link} /><p className="my-3 text-sm text-soft">Add your website to <a href={`${workspace}/settings#embed-settings`} className="font-semibold text-ink underline decoration-[1.5px] underline-offset-4 hover:decoration-gold-deep">allowed embed origins</a> before mounting an embed.</p><div className="grid gap-2"><Button type="button" variant="secondary" onClick={() => void copy("inline")}>Copy embed code (inline)</Button><Button type="button" variant="secondary" onClick={() => void copy("modal")}>Copy embed code (modal)</Button></div></> : <p className="mt-3 text-sm text-soft">Publish this event or Open requests to share its live link.</p>}{notice ? <p role="status" className="mt-3 text-sm">{notice}</p> : null}</Card>;
}

/** A URL that wraps after its slashes, so a long link breaks between path parts instead of inside a word. */
function BreakableUrl({ url }: { url: string }) {
  const parts = url.split(/(?<=[^/:]\/)/);
  return <>{parts.map((part, index) => <Fragment key={index}>{part}{index < parts.length - 1 ? <wbr /> : null}</Fragment>)}</>;
}
