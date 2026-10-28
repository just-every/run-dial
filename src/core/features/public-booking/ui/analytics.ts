import { useEffect } from "react";

type Tags = { ga4MeasurementId?: string; gtmContainerId?: string; metaPixelId?: string; googleAds?: { conversionId: string; conversionLabel: string }; linkedInPartnerId?: string };
let configuration: Promise<Tags> | undefined, measurement: Promise<HTMLIFrameElement> | undefined;
const deliveries = new Map<string, () => void>();
function safePage() { return window.location.origin + window.location.pathname.replace(/\/(?:details|confirmed)$/, ""); }
function reportFailure() { console.warn("Booking analytics could not be delivered."); }
async function configured() {
  configuration ??= fetch("/api/public/analytics", { credentials: "omit" }).then(async response => {
    if (!response.ok) throw new Error("analytics_configuration_unavailable");
    return response.json() as Promise<Tags>;
  });
  return configuration;
}
function frame() {
  measurement ??= new Promise<HTMLIFrameElement>((resolve, reject) => {
    const element=window.document.createElement("iframe");
    element.hidden=true;element.tabIndex=-1;element.setAttribute("aria-hidden","true");element.title="Booking measurement";
    element.sandbox.add("allow-scripts");element.referrerPolicy="no-referrer";
    const timer=window.setTimeout(()=>reject(new Error("analytics_frame_unavailable")),5000);
    window.addEventListener("message",message=>{
      if(message.source!==element.contentWindow||!message.data||typeof message.data!=="object")return;
      if(message.data.type==="dial:analytics-frame-ready") {
        const key="dial.analytics.client";let clientId=sessionStorage.getItem(key);if(!clientId){clientId=crypto.randomUUID();sessionStorage.setItem(key,clientId);}
        element.contentWindow!.postMessage({type:"dial:analytics-init",pageLocation:safePage(),clientId},"*");
      } else if(message.data.type==="dial:analytics-initialized"){window.clearTimeout(timer);resolve(element);}
      else if(message.data.type==="dial:analytics-delivered"&&typeof message.data.requestId==="string"){deliveries.get(message.data.requestId)?.();}
    });
    element.src="/api/public/analytics/frame";window.document.body.appendChild(element);
  });
  return measurement;
}
export function useBookingAnalytics(embedded: boolean, preview = false, pageView = false) {
  useEffect(() => {
    if (embedded || preview) return;
    void (pageView ? bookingAnalyticsEvent("page_view", safePage()) : configured()).catch(reportFailure);
  }, [embedded, preview, pageView]);
}
export async function bookingAnalyticsEvent(event: "page_view" | "slot_selected" | "booking_confirmed", identity: string) {
  if (window.parent !== window || window.location.pathname.startsWith("/embed/")) return;
  const tags=await configured();if(!Object.keys(tags).length)return;
  const key=`dial.analytics.${event}.${identity}`;if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,"sent");
  const element=await frame(),requestId=crypto.randomUUID();
  const eventId=event==="slot_selected"?Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(identity))),value=>value.toString(16).padStart(2,"0")).join(""):identity;
  await new Promise<void>(resolve=>{
    const done=()=>{window.clearTimeout(timer);deliveries.delete(requestId);resolve();};
    const timer=window.setTimeout(done,1500);deliveries.set(requestId,done);
    element.contentWindow!.postMessage({type:"dial:analytics-event",requestId,event,identity:eventId,pageLocation:safePage()},"*");
  });
}
export async function confirmedAnalytics(identity: string, embedded: boolean) {
  if (!embedded) await bookingAnalyticsEvent("booking_confirmed", identity).catch(reportFailure);
}
export function rememberPendingAnalytics(url: string) {
  const target=new URL(url,window.location.origin);
  if(target.origin===window.location.origin)sessionStorage.setItem(`dial.analytics.pending.${target.pathname}`,"waiting");
}
export async function completePendingAnalytics(booking: { bookingReference?: string; state: string; approval?: unknown }, embedded: boolean) {
  const key=`dial.analytics.pending.${window.location.pathname}`;
  if(embedded||!booking.bookingReference||booking.approval||booking.state!=="confirmed"||!sessionStorage.getItem(key))return;
  await confirmedAnalytics(booking.bookingReference,false);sessionStorage.removeItem(key);
}
