import { useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button } from "../../../app/ui/primitives";
import type { BookingLink } from "../service";
import { hostSetupChanged } from "./use-host-setup";

export function CopyBookingLink({ link }: { link: BookingLink }) {
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  async function copy() {
    setWorking(true); setNotice("");
    try {
      await navigator.clipboard.writeText(link.url);
    } catch { setNotice("The booking link could not be copied. Allow clipboard access and try again."); setWorking(false); return; }
    try {
      const response = await api.api.app["event-types"][":id"]["copy-report"].$post({ param: { id: link.eventTypeId }, json: { url: link.url } }, { headers: { "X-Dial-Copy-Report": "1" } });
      if (!response.ok) throw new Error(await errorMessage(response));
      setNotice("Booking link copied."); hostSetupChanged();
    } catch (error) { setNotice(`The link was copied, but completion could not be saved. ${error instanceof Error ? error.message : "Copy again to record completion."}`); }
    finally { setWorking(false); }
  }
  return <div className="grid min-w-0 gap-2"><Button type="button" variant="secondary" icon="link" disabled={working} onClick={() => void copy()}>Copy booking link</Button>{notice ? <p role="status" className="max-w-sm text-sm text-soft">{notice}</p> : null}</div>;
}
