import { useEffect } from "react";

type Tags = { ga4MeasurementId?: string; gtmContainerId?: string; metaPixelId?: string; googleAds?: { conversionId: string; conversionLabel: string }; linkedInPartnerId?: string };
type Command = (...values: unknown[]) => void;
type TrackingWindow = Window & { dataLayer?: unknown[]; gtag?: Command; fbq?: Command & { queue?: unknown[][]; loaded?: boolean; version?: string; callMethod?: Command; push?: Command }; _linkedin_partner_id?: string; _linkedin_data_partner_ids?: string[]; lintrk?: Command & { q?: unknown[][] } };
let configuration: Promise<Tags> | undefined;
const loadedScripts = new Set<string>();

function script(source: string) {
  if (loadedScripts.has(source)) return;
  loadedScripts.add(source);
  const element = window.document.createElement("script");
  element.async = true; element.src = source; element.referrerPolicy = "no-referrer";
  window.document.head.appendChild(element);
}

async function configured() {
  configuration ??= fetch("/api/public/analytics", { credentials: "omit" }).then(async response => {
    if (!response.ok) throw new Error("analytics_configuration_unavailable");
    const tags = await response.json() as Tags;
    const target = window as TrackingWindow;
    const googleIds = [tags.ga4MeasurementId, tags.googleAds?.conversionId].filter((value): value is string => Boolean(value));
    if (googleIds.length || tags.gtmContainerId) target.dataLayer ??= [];
    if (googleIds.length) {
      // Preserve Google’s documented Arguments command queue for its loader.
      // eslint-disable-next-line prefer-rest-params
      target.gtag ??= function () { target.dataLayer!.push(arguments); };
      target.gtag("js", new Date());
      for (const id of googleIds) target.gtag("config", id, { send_page_view: false, page_location: safePage(), page_referrer: "", allow_google_signals: false, allow_ad_personalization_signals: false });
      script(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(googleIds[0])}`);
    }
    if (tags.gtmContainerId) {
      target.dataLayer!.push({ "gtm.start": Date.now(), event: "gtm.js" });
      script(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(tags.gtmContainerId)}`);
    }
    if (tags.metaPixelId) {
      const fbq: NonNullable<TrackingWindow["fbq"]> = function (...values) { if (fbq.callMethod) fbq.callMethod(...values); else fbq.queue!.push(values); };
      fbq.queue = []; fbq.loaded = true; fbq.version = "2.0"; fbq.push = fbq;
      target.fbq ??= fbq;
      target.fbq("set", "autoConfig", false, tags.metaPixelId);
      target.fbq("init", tags.metaPixelId);
      script("https://connect.facebook.net/en_US/fbevents.js");
    }
    if (tags.linkedInPartnerId) {
      target._linkedin_partner_id = tags.linkedInPartnerId;
      target._linkedin_data_partner_ids = [tags.linkedInPartnerId];
      const lintrk: NonNullable<TrackingWindow["lintrk"]> = (...values) => lintrk.q!.push(values);
      lintrk.q = []; target.lintrk ??= lintrk;
      script("https://snap.licdn.com/li.lms-analytics/insight.min.js");
    }
    return tags;
  });
  return configuration;
}

// Never send a query, fragment, receipt capability, referrer, name or answer to tags.
function safePage() { return window.location.origin + window.location.pathname.replace(/\/(?:details|confirmed)$/, ""); }
function reportFailure() { console.warn("Booking analytics could not be delivered."); }

export function useBookingAnalytics(embedded: boolean, preview = false, pageView = false) {
  useEffect(() => {
    if (embedded || preview) return;
    void (pageView ? bookingAnalyticsEvent("page_view", safePage()) : configured()).catch(reportFailure);
  }, [embedded, preview, pageView]);
}

export async function bookingAnalyticsEvent(event: "page_view" | "slot_selected" | "booking_confirmed", identity: string) {
  if (window.parent !== window || window.location.pathname.startsWith("/embed/")) return;
  const tags = await configured();
  if (!Object.keys(tags).length) return;
  const key = `dial.analytics.${event}.${identity}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "sent");
  const target = window as TrackingWindow;
  const eventId = event === "slot_selected" ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity))), value => value.toString(16).padStart(2, "0")).join("") : identity;
  const fields = { page_location: safePage(), page_referrer: "", event_id: eventId };
  if (tags.gtmContainerId) target.dataLayer!.push({ event, ...fields });
  if (tags.metaPixelId) target.fbq!("trackCustom", event, {}, { eventID: eventId });
  if (tags.linkedInPartnerId) target.lintrk!("track", { event_name: event, event_id: eventId });
  const commands: Array<[string, string[]]> = [];
  if (tags.ga4MeasurementId) commands.push([event, [tags.ga4MeasurementId]]);
  if (event === "booking_confirmed" && tags.googleAds) commands.push(["conversion", [`${tags.googleAds.conversionId}/${tags.googleAds.conversionLabel}`]]);
  await Promise.all(commands.map(([name, sendTo]) => new Promise<void>(resolve => {
    const timeout = window.setTimeout(resolve, 1000);
    target.gtag!("event", name, { ...fields, send_to: sendTo, ...(event === "booking_confirmed" ? { transaction_id: identity } : {}), event_timeout: 900, event_callback: () => { window.clearTimeout(timeout); resolve(); } });
  })));
}

export async function confirmedAnalytics(identity: string, embedded: boolean) {
  if (!embedded) await bookingAnalyticsEvent("booking_confirmed", identity).catch(reportFailure);
}

export function rememberPendingAnalytics(url: string) {
  const target = new URL(url, window.location.origin);
  if (target.origin === window.location.origin) sessionStorage.setItem(`dial.analytics.pending.${target.pathname}`, "waiting");
}
export async function completePendingAnalytics(booking: { bookingReference?: string; state: string; approval?: unknown }, embedded: boolean) {
  const key = `dial.analytics.pending.${window.location.pathname}`;
  if (embedded || !booking.bookingReference || booking.approval || booking.state !== "confirmed" || !sessionStorage.getItem(key)) return;
  await confirmedAnalytics(booking.bookingReference, false);
  sessionStorage.removeItem(key);
}
