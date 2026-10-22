import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../../../api/client";
import { useHydrated } from "../../../app/use-hydrated";
import { Button, Input } from "../../../app/ui/primitives";

export function GuestSettings({eventId}:{eventId:string}) {
  const [limit,setLimit]=useState(0),[loaded,setLoaded]=useState(false),[working,setWorking]=useState(false),[notice,setNotice]=useState("");
  const hydrated=useHydrated();
  useEffect(()=>{let active=true;void (async()=>{try{const response=await api.api.app["event-types"][":id"].guests.$get({param:{id:eventId}});if(!active)return;if(!response.ok){setNotice(await errorMessage(response));return;}const result=await response.json();setLimit(result.guestLimit);setLoaded(true);}catch{if(active)setNotice("Guest settings could not be loaded. Reload to try again.");}})();return()=>{active=false;};},[eventId]);
  async function save(event:FormEvent){event.preventDefault();setWorking(true);setNotice("");try{const response=await api.api.app["event-types"][":id"].guests.$put({param:{id:eventId},json:{guestLimit:limit}});setNotice(response.ok?"Guest settings saved.":await errorMessage(response));}catch{setNotice("Guest settings could not be saved. Try again.");}finally{setWorking(false);}}
  return <form aria-label="Invitee guests" onSubmit={event=>void save(event)} className="grid gap-4 rounded-xl border border-line p-4"><h3 className="font-semibold">Invitee guests</h3><p className="text-sm text-muted">Guests receive calendar invitations and booking notices. Only the invitee can manage the booking.</p><fieldset disabled={!hydrated||!loaded||working} className="grid gap-4 border-0 p-0"><label className="grid gap-2 text-sm font-semibold">Maximum guests<Input type="number" min={0} max={20} value={limit} onChange={event=>setLimit(Number(event.target.value))} required /></label><p className="text-sm text-muted">Set to 0 to keep guest invitations off. Existing bookings keep their guest limit.</p><Button type="submit">{working?"Saving…":"Save guest settings"}</Button></fieldset>{notice?<p role="status" className="text-sm">{notice}</p>:null}</form>;
}
