import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnvironment } from "../../app/context";
import { apiError } from "../../shared/http";
import { ianaTimeZoneSchema } from "../../shared/scheduling";
import { validate } from "../../shared/validation";
import { normaliseEmbedOrigin } from "./service";

const embedParamsSchema = z.object({ handle: z.string().regex(/^[a-z0-9-]+$/).max(80), slug: z.string().regex(/^[a-z0-9-]+$/).max(80) });
const originsSchema = z.object({
  allowedOrigins: z.array(z.string().min(1).max(300)).max(30).transform((values, context) => {
    const origins = values.map((value, index) => {
      const normalised = normaliseEmbedOrigin(value);
      if (!normalised) context.addIssue({ code: "custom", path: ["allowedOrigins", index], message: "Use an exact HTTPS origin, or a loopback HTTP origin for local development." });
      return normalised;
    });
    if (origins.some((origin) => !origin)) return z.NEVER;
    if (new Set(origins).size !== origins.length) context.addIssue({ code: "custom", path: ["allowedOrigins"], message: "Allowed origins must be unique." });
    return origins as string[];
  }),
});
const parentSchema = z.object({ parent: z.string().min(1).max(300).optional() });
const selectionEmbedQuerySchema = parentSchema.extend({ nonce: z.string().min(1).max(200).optional(), startAt: z.string().datetime({ offset: true }).optional(), inviteeTimezone: ianaTimeZoneSchema.optional() });
const confirmedEmbedQuerySchema = parentSchema.extend({ token: z.string().min(1).max(512).optional() });

export const embedRoutes = new Hono<AppEnvironment>()
  .get("/api/app/embed-settings", async (context) => context.json({ allowedOrigins: await context.get("services").embeds.listAllowedOrigins() }))
  .put("/api/app/embed-settings", validate("json", originsSchema), async (context) => {
    return context.json({ allowedOrigins: await context.get("services").embeds.replaceAllowedOrigins(context.req.valid("json").allowedOrigins) });
  })
  .get("/embed/dial.js", (context) => {
    context.header("Content-Type", "application/javascript; charset=utf-8");
    context.header("Cache-Control", "public, max-age=300");
    return context.body(embedBootstrap);
  })
  .get("/embed/manage/:token", validate("param", z.object({ token: z.string().min(1).max(512) })), validate("query", parentSchema), async (context) => {
    const parentOrigin = await allowedManageEmbedParent(context, context.req.valid("query").parent ?? "");
    if (!parentOrigin) return blockedEmbedSurface(context);
    const booking = await context.get("services").bookings.getManageBooking(context.req.valid("param").token);
    return booking.kind === "found" ? embeddedSurface(context, parentOrigin) : embeddedRecoverySurface(context, parentOrigin, booking.kind === "expired" ? 410 : 404);
  })
  .get("/embed/:handle/:slug", validate("param", embedParamsSchema), validate("query", parentSchema), async (context) => {
    const { handle, slug } = context.req.valid("param");
    return publicEmbedSurface(context, handle, slug, context.req.valid("query").parent ?? "");
  })
  .get("/embed/:handle/:slug/details", validate("param", embedParamsSchema), validate("query", selectionEmbedQuerySchema), async (context) => {
    const { handle, slug } = context.req.valid("param");
    const query = context.req.valid("query");
    return publicEmbedDetailsSurface(context, handle, slug, query);
  })
  .get("/embed/:handle/:slug/confirmed", validate("param", embedParamsSchema), validate("query", confirmedEmbedQuerySchema), async (context) => {
    const { handle, slug } = context.req.valid("param");
    const query = context.req.valid("query");
    return publicEmbedConfirmationSurface(context, handle, slug, query);
  })
  .get("/embed/:handle/:slug/request", validate("param", embedParamsSchema), validate("query", parentSchema), async (context) => publicEmbedSurface(context, context.req.valid("param").handle, context.req.valid("param").slug, context.req.valid("query").parent ?? ""))
  .get("/embed/*", (context) => blockedEmbedSurface(context));

async function publicEmbedSurface(context: Context<AppEnvironment>, handle: string, slug: string, parent: string) {
  const parentOrigin = await allowedEmbedParent(context, handle, slug, parent);
  return parentOrigin ? embeddedSurface(context, parentOrigin) : blockedEmbedSurface(context);
}

async function publicEmbedDetailsSurface(context: Context<AppEnvironment>, handle: string, slug: string, query: z.infer<typeof selectionEmbedQuerySchema>) {
  const parentOrigin = await allowedEmbedParent(context, handle, slug, query.parent ?? "");
  if (!parentOrigin) return blockedEmbedSurface(context);
  if (!query.nonce || !query.startAt || !query.inviteeTimezone) return embeddedRecoverySurface(context, parentOrigin, 404);
  const selection = await context.get("services").bookings.getPublicSelection({ handle, slug, nonce: query.nonce, startAt: query.startAt, inviteeTimezone: query.inviteeTimezone });
  return selection.kind === "found" ? embeddedSurface(context, parentOrigin) : embeddedRecoverySurface(context, parentOrigin, selection.kind === "expired" ? 410 : 404);
}

async function publicEmbedConfirmationSurface(context: Context<AppEnvironment>, handle: string, slug: string, query: z.infer<typeof confirmedEmbedQuerySchema>) {
  const parentOrigin = await allowedEmbedParent(context, handle, slug, query.parent ?? "");
  if (!parentOrigin) return blockedEmbedSurface(context);
  if (!query.token) return embeddedRecoverySurface(context, parentOrigin, 404);
  const booking = await context.get("services").bookings.getManageBooking(query.token);
  return booking.kind === "found" ? embeddedSurface(context, parentOrigin) : embeddedRecoverySurface(context, parentOrigin, booking.kind === "expired" ? 410 : 404);
}

async function allowedEmbedParent(context: Context<AppEnvironment>, handle: string, slug: string, parent: string) {
  const parentOrigin = normaliseEmbedOrigin(parent);
  return parentOrigin && await context.get("services").embeds.canEmbed(handle, slug, parentOrigin) ? parentOrigin : undefined;
}

async function allowedManageEmbedParent(context: Context<AppEnvironment>, parent: string) {
  const parentOrigin = normaliseEmbedOrigin(parent);
  return parentOrigin && await context.get("services").embeds.isOriginAllowed(parentOrigin) ? parentOrigin : undefined;
}

function embeddedSurface(context: Context<AppEnvironment>, parentOrigin: string) {
  return context.get("services").spaSurface.serve(context.req.raw, 200, { frameAncestors: [parentOrigin] });
}

function embeddedRecoverySurface(context: Context<AppEnvironment>, parentOrigin: string, status: 404 | 410) {
  return context.get("services").spaSurface.serve(context.req.raw, status, { frameAncestors: [parentOrigin] });
}

function blockedEmbedSurface(context: Parameters<typeof apiError>[0]) {
  return context.get("services").spaSurface.serve(context.req.raw, 404, { blockFraming: true });
}

/** Kept self-contained so embedding remains async and its initial response stays far below 50KB gzip. */
const embedBootstrap = `(()=>{const boot=()=>{const current=document.currentScript;const scripts=current?[current]:Array.from(document.querySelectorAll('script[data-dial-embed][src*="/embed/dial.js"]'));scripts.forEach(script=>{if(script.dataset.dialMounted)return;const handle=script.dataset.dialHandle,slug=script.dataset.dialEmbed,mode=script.dataset.dialMode||'inline';if(!handle||!slug||!['inline','modal'].includes(mode))return;script.dataset.dialMounted='true';const source=new URL(script.src,window.location.href).origin;const frame=()=>{const f=document.createElement('iframe'),parent=window.location.origin;f.src=source+'/embed/'+encodeURIComponent(handle)+'/'+encodeURIComponent(slug)+'?parent='+encodeURIComponent(parent)+'#dial-parent='+encodeURIComponent(parent);f.title='Book '+slug;f.loading='lazy';f.style.cssText='width:100%;min-height:680px;border:0;background:transparent';return f};if(mode==='inline'){script.insertAdjacentElement('afterend',frame());return}Array.from(document.querySelectorAll('[data-dial-embed]')).filter(trigger=>trigger!==script&&trigger.getAttribute('data-dial-embed')===slug).forEach(trigger=>{const open=event=>{event.preventDefault();const shell=document.createElement('div'),card=document.createElement('div'),close=document.createElement('button'),origin=document.activeElement;let dismiss;const keydown=e=>{if(e.key==='Escape'){e.preventDefault();dismiss();return}if(e.key==='Tab'){const items=Array.from(shell.querySelectorAll('button,[href],iframe')).filter(item=>!item.hasAttribute('disabled'));if(!items.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};dismiss=()=>{document.removeEventListener('keydown',keydown);shell.remove();if(origin instanceof HTMLElement)origin.focus()};shell.setAttribute('role','dialog');shell.setAttribute('aria-modal','true');shell.setAttribute('aria-label','Schedule a time');shell.style.cssText='position:fixed;z-index:2147483647;inset:0;padding:24px;display:grid;place-items:center;background:rgba(8,36,31,.48)';card.style.cssText='position:relative;width:min(760px,100%);max-height:100%;overflow:auto;background:#fffefa;border-radius:18px';close.type='button';close.textContent='Close';close.setAttribute('aria-label','Close scheduling window');close.style.cssText='position:absolute;right:10px;top:10px;z-index:1;min-height:44px;padding:0 12px;border:0;border-radius:8px;background:#fff;color:#1d1c1a;font:600 14px system-ui';close.addEventListener('click',dismiss);shell.addEventListener('click',e=>{if(e.target===shell)dismiss()});document.addEventListener('keydown',keydown);card.append(close,frame());shell.append(card);document.body.append(shell);close.focus()};trigger.addEventListener('click',open);if(!(trigger instanceof HTMLButtonElement||trigger instanceof HTMLAnchorElement)){trigger.setAttribute('role','button');trigger.tabIndex=0;trigger.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();trigger.click()}})}})})};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot()})();`;
