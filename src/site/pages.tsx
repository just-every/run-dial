import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { contractPageHtml } from "../base/contract-page";
import { runPageHtml, siteNotFoundHtml, type SiteBuild, type SiteContext } from "../base/run-site";
import { siteIdentity } from "./identity";
import { run } from "./run";
import { Landing } from "../core/features/public-site/landing/Landing";
import { DocsPage } from "../core/features/public-site/docs/DocsPage";
import { pages, sections, repository, version, problem } from "virtual:dial-docs";
import { fontStylesheet, primaryFontPreload } from "../core/features/public-site/chrome/font-head";
import favicon from "../core/features/public-booking/ui/favicon.svg?url&no-inline";
import "../core/app/styles.css";
import "../core/features/public-booking/ui/public-booking.css";
import "../core/features/public-booking/ui/public-forms.css";

export async function sitePages({ styles, contract }: SiteContext): Promise<SiteBuild> {
  if (problem) throw new Error(problem);
  const document = (title: string, description: string, body: ReactElement) => "<!doctype html>" + renderToStaticMarkup(
    <html lang="en"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title><meta name="description" content={description} />
      <link rel="icon" type="image/svg+xml" href={favicon} /><link {...fontStylesheet} /><link {...primaryFontPreload} />
      {styles.map(href => <link key={href} rel="stylesheet" href={href} />)}</head><body><div id="root">{body}</div></body></html>);
  const docs = await Promise.all(Object.entries(pages).map(async ([slug, load]) => {
    const page = (await load()).default;
    return { path: slug ? `/docs/${slug}` : "/docs", html: document(slug ? `${page.title} · Dial docs` : "Dial docs", page.description,
      <DocsPage page={page} sections={sections} repository={repository} version={version} variant="site" />) };
  }));
  return { pages: [
    { path: "/", html: document("Dial · Pick a time. That’s it.", "100% free, open source alternative to Calendly, Acuity Scheduling and SavvyCal. Dial is an open-source booking page. It checks your live calendar, speaks every timezone and never asks invitees to sign up.", <Landing variant="site" />) },
    { path: "/run", html: runPageHtml(siteIdentity, run, contract) },
    ...(contract ? [{ path: "/contract", html: contractPageHtml(siteIdentity, run, contract) }] : []), ...docs,
    { path: "/404", html: siteNotFoundHtml(siteIdentity, run, contract) },
  ], assets: ["rer-theme.css", "rer-mark.svg", "fonts", "brand"] };
}
