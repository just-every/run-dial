import { useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Input } from "../../../app/ui/primitives";
import type { BookingLink } from "../service";
import { hostSetupChanged } from "./use-host-setup";

export function CopyBookingLink({ link }: { link: BookingLink }) {
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  // Without clipboard access the host copies the link by hand and confirms it.
  const [manual, setManual] = useState(false);
  async function report(done: string, failed: string, retry: string) {
    try {
      const response = await api.api.app["event-types"][":id"]["copy-report"].$post({ param: { id: link.eventTypeId }, json: { url: link.url } }, { headers: { "X-Dial-Copy-Report": "1" } });
      if (!response.ok) throw new Error(await errorMessage(response));
      setNotice(done); hostSetupChanged();
    } catch (error) { setNotice(`${failed} ${error instanceof Error ? error.message : retry}`); }
    finally { setWorking(false); }
  }
  async function copy() {
    setWorking(true); setNotice("");
    try {
      await navigator.clipboard.writeText(link.url);
    } catch { setManual(true); setNotice("The booking link could not be copied. Select it in the box above, copy it yourself, then choose I have shared it."); setWorking(false); return; }
    await report("Booking link copied.", "The link was copied, but completion could not be saved.", "Copy again to record completion.");
  }
  async function shared() {
    setWorking(true); setNotice("");
    await report("Booking link marked as shared.", "Sharing could not be saved.", "Confirm again to record completion.");
  }
  return <div className="grid min-w-0 gap-2"><Button type="button" variant="secondary" icon="link" disabled={working} onClick={() => void copy()}>Copy booking link</Button>
    {manual ? <><Input readOnly aria-label="Booking link" value={link.url} onFocus={(event) => event.currentTarget.select()} className="font-mono text-[13px]" /><Button type="button" variant="secondary" icon="check" disabled={working} onClick={() => void shared()}>I have shared it</Button></> : null}
    {notice ? <p role="status" className="max-w-sm text-sm text-soft">{notice}</p> : null}</div>;
}
