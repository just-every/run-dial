export const hubspotBookingProperties=["dial_last_booking_id","dial_last_booking_state","dial_last_booking_start_at"] as const;
export class CrmFailure extends Error {
 constructor(readonly code:string){super(code);}
}

/** The origin is fixed; redirects never receive the workspace credential. */
export async function hubspotRequest(transport:typeof fetch,token:string,path:string,method="GET",body?:unknown) {
 let response:Response;
 try{response=await transport("https://api.hubapi.com"+path,{method,redirect:"manual",signal:AbortSignal.timeout(10000),
  headers:{Authorization:`Bearer ${token}`,"Content-Type":"application"+"/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 catch{throw new CrmFailure("crm_transport_unavailable");}
 if(!response.ok){await response.body?.cancel();throw new CrmFailure(response.status===401||response.status===403?"crm_unauthorized":response.status===404?"crm_contact_missing":"crm_provider_rejected");}
 const value=await response.json().catch(()=>undefined);
 if(!value||typeof value!=="object")throw new CrmFailure("crm_response_invalid");
 return value as Record<string,unknown>;
}
export async function checkHubspotProperties(transport:typeof fetch,token:string) {
 const result=await hubspotRequest(transport,token,"/crm/v3/properties/contacts");
 const properties=Array.isArray(result.results)?result.results:[];
 if(!hubspotBookingProperties.every(name=>properties.some(row=>row&&typeof row==="object"&&"name" in row&&row.name===name&&"type" in row&&row.type==="string")))
  throw new CrmFailure("crm_booking_properties_missing");
}
