import { useState, type FormEvent } from "react";
import { publicApi, errorMessage } from "../../../api/client";
import { GuestFields, guestEmails } from "./guest-fields";
import type { Confirmation } from "./types";
export function ManageGuests({token,booking,disabled,onChanged}:{token:string;booking:Confirmation;disabled:boolean;onChanged:(booking:Confirmation)=>void}){
  const [value,setValue]=useState((booking.guests??[]).join("\n")),[working,setWorking]=useState(false),[notice,setNotice]=useState("");
  if(!booking.guestLimit||booking.state==="cancelled")return null;
  async function save(event:FormEvent){event.preventDefault();setWorking(true);setNotice("");try{const response=await publicApi.api.public.manage[":token"].guests.$put({param:{token},json:{guests:guestEmails(value)}});if(!response.ok){setNotice(await errorMessage(response));return;}const next=await response.json() as Confirmation;onChanged(next);setValue((next.guests??[]).join("\n"));setNotice("Guests updated. Invitations and changes are queued.");}catch{setNotice("The result could not be received. Retry the same guest list to check it.");}finally{setWorking(false);}}
  return <form aria-label="Manage guests" onSubmit={event=>void save(event)} className="pb-request-form"><h2>Guests</h2><GuestFields limit={booking.guestLimit} value={value} onChange={setValue} disabled={disabled||working}/><button className="pb-secondary-button" type="submit" disabled={disabled||working}>{working?"Saving…":"Save guests"}</button>{notice?<p role="status">{notice}</p>:null}</form>;
}
