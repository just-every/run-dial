import { useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { publicApi, errorMessage } from "../../../api/client";
export type SavedClientDetails = { name: string; email: string; answers: Record<string,string|string[]>; phone?: string };

/** An email address alone never reads personal details. Redemption requires an explicit use of the mailed capability. */
export function RememberDetails({ handle, slug, email, disabled, onDetails }: { handle:string;slug:string;email:string;disabled:boolean;onDetails(details:SavedClientDetails):void }) {
  const search=useRouterState({select:state=>state.location.searchStr}),token=new URLSearchParams(search).get("remember");
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[used,setUsed]=useState(false);
  async function act(redeem:boolean) {
    setBusy(true);setNotice("");
    try {
      const endpoint=publicApi.api.public.book[":handle"][":slug"].remember;
      const response=redeem?await endpoint.redeem.$post({param:{handle,slug},json:{token:token ?? ""}}):await endpoint.request.$post({param:{handle,slug},json:{email}});
      if(!response.ok){setNotice(await errorMessage(response));return;}
      if(redeem){onDetails(await response.json() as SavedClientDetails);setUsed(true);setNotice("Saved details filled. Review them before booking.");}
      else setNotice("If saved details are available, a link will be sent to the address on the record.");
    } catch {setNotice("Saved details could not be requested. You can enter your details to book.");}
    finally {setBusy(false);}
  }
  return <section aria-label="Saved booking details" className="my-4 rounded-xl border border-line p-4">
    <p className="text-sm">Booked before? Email yourself a link to use your saved details for this event. The link works once and expires in 15 minutes.</p>
    <div className="mt-3 flex flex-wrap gap-3"><button type="button" className="pb-secondary-button" disabled={disabled||busy||!email} onClick={()=>void act(false)}>Email saved details</button>{token&&!used?<button type="button" className="pb-secondary-button" disabled={disabled||busy} onClick={()=>void act(true)}>Use saved details</button>:null}</div>
    {notice?<p role="status" className="mt-3 text-sm">{notice}</p>:null}
  </section>;
}
