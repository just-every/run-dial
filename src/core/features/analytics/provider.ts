import { AnalyticsFailure, type ConversionRecord, type Destination } from "./types";

/** Fixed provider endpoints; neither credentials nor invitee answers become request URLs. */
export async function uploadConversion(transport: typeof fetch, record: ConversionRecord, credentials: {accessToken:string;developerToken?:string}) {
  const destination = JSON.parse(record.destination_json) as Destination;
  const google = record.provider === "google_ads";
  if (!credentials.accessToken || (google && (!credentials.developerToken || !destination.customerId || !destination.conversionAction)) || (!google && !destination.conversionId)) throw new AnalyticsFailure("conversion_configuration_invalid");
  const endpoint = google ? `https://googleads.googleapis.com/v26/customers/${destination.customerId}:uploadClickConversions` : "https://api.linkedin.com/rest/conversionEvents";
  const headers: Record<string,string> = {authorization:`Bearer ${credentials.accessToken}`,"content-type":"application/json"};
  if (google) {
    headers["developer-token"] = credentials.developerToken!;
    if (destination.loginCustomerId) headers["login-customer-id"] = destination.loginCustomerId;
  } else { headers["LinkedIn-Version"] = "202610"; headers["X-Restli-Protocol-Version"] = "2.0.0"; }
  const body = google ? {partialFailure:true,conversions:[{gclid:record.click_id,conversionAction:destination.conversionAction,conversionDateTime:record.confirmed_at.slice(0,19).replace('T',' ')+"+00:00",orderId:record.event_id}]} : {
    conversion:`urn:lla:llaPartnerConversion:${destination.conversionId}`,conversionHappenedAt:Date.parse(record.confirmed_at),eventId:record.event_id,
    user:{userIds:[{idType:"LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID",idValue:record.click_id}]},
  };
  let response: Response;
  try { response = await transport(endpoint,{method:"POST",headers,body:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(10000)}); }
  catch { throw new AnalyticsFailure("conversion_transport_failed",true); }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new AnalyticsFailure(response.status===401 || response.status===403 ? "conversion_authorization_refused" : `conversion_http_${response.status}`,response.status===429 || response.status>=500,Number.isFinite(retryAfter)?Math.max(0,retryAfter):0);
  }
  if (!google) return;
  let value: {partialFailureError?: {code?:number;details?:Array<{errors?:Array<{errorCode?:Record<string,string>}>}>};results?:unknown[]};
  try { value = await response.json(); } catch { throw new AnalyticsFailure("conversion_invalid_response",true); }
  if (value.partialFailureError && value.partialFailureError.code !== 0) {
    const codes = value.partialFailureError.details?.flatMap(detail=>detail.errors?.flatMap(error=>Object.values(error.errorCode??{}))??[])??[];
    if (codes.length && codes.every(code=>code==="CLICK_CONVERSION_ALREADY_EXISTS")) return;
    throw new AnalyticsFailure("conversion_partial_failure",codes.some(code=>["RESOURCE_EXHAUSTED","INTERNAL_ERROR","TEMPORARY_ERROR","UNAVAILABLE"].includes(code)));
  }
  if (!Array.isArray(value.results) || value.results.length!==1 || !value.results[0] || typeof value.results[0]!=="object" || !Object.keys(value.results[0]).length) throw new AnalyticsFailure("conversion_invalid_response",true);
}
