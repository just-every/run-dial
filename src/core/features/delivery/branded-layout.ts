import type { MailBrand } from "./mail-brand";
import { validateMailUrl } from "./mail-action-url";
export { validateMailUrl } from "./mail-action-url";

export const dialAccent = "#1d1c1a";
export const dialButtonText = "#ffffff";
const htmlEscapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
};

export type BrandedMailFact = { label: string; value: string };
export type BrandedMailAction = { label: string; href: string };
export type BrandedMailInput = {
  businessName?: string;
  brand?: MailBrand;
  heading: string;
  intro?: string;
  paragraphs?: string[];
  facts?: BrandedMailFact[];
  actions?: BrandedMailAction[];
};

/** Render plain values through Dial's one table based, inline styled mail frame. */
export function renderBrandedMail(input: BrandedMailInput) {
  const businessName = input.brand?.name ?? input.businessName ?? "Dial";
  const background = input.brand?.colours.background ?? "#f4f1ea";
  const surface = input.brand?.colours.background ?? "#fcfaf5";
  const header = input.brand?.colours.background ?? "#f6edd6";
  const ink = input.brand?.colours.ink ?? "#1d1c1a";
  const muted = input.brand?.colours.ink ?? "#66635c";
  const bodyInk = input.brand?.colours.ink ?? "#44423d";
  const accent = input.brand?.colours.accent ?? dialAccent;
  const buttonInk = input.brand?.colours.buttonInk ?? dialButtonText;
  const mark = input.brand?.markUrl
    ? `<img src="${escapeHtml(validateMailUrl(input.brand.markUrl))}" alt="${escapeHtml(businessName)}" width="160" style="display:block;max-width:160px;max-height:64px;width:auto;height:auto;border:0">`
    : "DIAL";
  const paragraphs = (input.paragraphs ?? []).map((paragraph) =>
    `<tr><td dir="auto" style="padding:0 0 14px;color:${bodyInk};font:16px/1.55 Arial,Helvetica,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(paragraph)}</td></tr>`).join("");
  const facts = (input.facts ?? []).map(({ label, value }) =>
    `<tr><td dir="auto" width="34%" valign="top" style="width:34%;padding:11px 10px 11px 0;border-top:1px solid #dcd7cc;color:${muted};font:600 13px/1.45 Arial,Helvetica,sans-serif;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(label)}</td><td dir="auto" valign="top" style="padding:11px 0;border-top:1px solid #dcd7cc;color:${ink};font:15px/1.5 Arial,Helvetica,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(value)}</td></tr>`).join("");
  const actions = (input.actions ?? []).map(({ label, href }) => {
    const safeHref = escapeHtml(validateMailUrl(href));
    return `<tr><td style="padding:5px 0"><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td bgcolor="${accent}" style="border-radius:999px;background:${accent}"><a href="${safeHref}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:${accent};color:${buttonInk};font:700 14px/1.2 Arial,Helvetica,sans-serif;text-decoration:none;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(label)}</a></td></tr></table></td></tr>`;
  }).join("");
  const intro = input.intro ? `<tr><td dir="auto" style="padding:0 0 15px;color:${bodyInk};font:16px/1.55 Arial,Helvetica,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(input.intro)}</td></tr>` : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.heading)}</title></head><body style="margin:0;padding:0;background:${background};color:${ink};font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:${background}"><tr><td align="center" style="padding:18px 10px"><table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;table-layout:fixed;border-collapse:separate;border-spacing:0;background:${surface};border:1px solid #dcd7cc;border-radius:14px"><tr><td style="padding:21px 22px;background:${header};border-radius:14px 14px 0 0"><table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;border-collapse:collapse"><tr><td style="color:${ink};font:700 14px/1.3 Arial,Helvetica,sans-serif;letter-spacing:.04em">${mark}</td></tr><tr><td dir="auto" style="padding-top:6px;color:${ink};font:600 14px/1.4 Arial,Helvetica,sans-serif;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(businessName)}</td></tr></table></td></tr><tr><td style="padding:24px 22px 22px"><table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;border-collapse:collapse"><tr><td dir="auto" style="padding:0 0 14px;color:${ink};font:700 24px/1.25 Arial,Helvetica,sans-serif;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(input.heading)}</td></tr>${intro}${paragraphs}${facts ? `<tr><td style="padding:4px 0 18px"><table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;border-collapse:collapse">${facts}</table></td></tr>` : ""}${actions}</table></td></tr><tr><td style="padding:13px 22px;border-top:1px solid #dcd7cc;color:${muted};font:13px/1.4 Arial,Helvetica,sans-serif">Sent by Dial</td></tr></table></td></tr></table></body></html>`;
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => htmlEscapes[character]);
}

export function inviteeCalendarUrl(manageUrl: string) {
  const validated = new URL(validateMailUrl(manageUrl));
  const match = /^\/manage\/([^/]+)\/?$/u.exec(validated.pathname);
  if (!match) throw new TypeError("Invitee manage URL has an invalid path");
  validated.pathname = `/api/public/manage/${match[1]}/calendar.ics`;
  validated.search = "";
  validated.hash = "";
  return validated.href;
}
