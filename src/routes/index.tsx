import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { primaryFontPreload } from "../core/features/public-site/chrome/font-head";
import { Landing } from "../core/features/public-site/landing/Landing";

/** HOME-001. The public product landing; the host's booking profile, when there is one, comes in the root document data. */
export const Route = createFileRoute("/")({
  head: () => ({
    links: [primaryFontPreload],
    meta: [
      { title: "Dial · Pick a time. That’s it." },
      { name: "description", content: "100% free, open source alternative to Calendly, Acuity Scheduling and SavvyCal. Dial is an open-source booking page you run on your own Cloudflare account. It checks your live calendar, speaks every timezone and never asks invitees to sign up." },
    ],
  }),
  component: withEditorLeaf(Landing),
});
