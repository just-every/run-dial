/** The existing public form's native fields keep the guest choice optional and explicitly bounded. */
export function GuestFields({limit,value,onChange,disabled=false}:{limit:number;value:string;onChange:(value:string)=>void;disabled?:boolean}){
  if(limit<1)return null;
  return <label><span className="pb-label-text">Guest emails (optional)</span><textarea aria-label="Guest emails (optional)" disabled={disabled} rows={3} value={value} onChange={event=>onChange(event.target.value)} maxLength={limit*321} /><span className="text-sm">Up to {limit} guests, one email per line. Guests receive invitations and change notices, without your manage link.</span></label>;
}
export const guestEmails=(value:string)=>value.split(/[\n,;]/u).map(email=>email.trim()).filter(Boolean);
