import type { EditionIdentity } from "../base/identity";
import declaration from "../../deploy-site.json";
export const siteIdentity: EditionIdentity = {
  product: "Dial", deployment: "Dial", purpose: "{deployment}’s booking page and scheduling workspace.",
  tagline: "A booking page that checks your live calendar, speaks every timezone and never asks invitees to sign up. Open source.",
  signInPath: "/signin", runSite: `https://${declaration.domain}`, installedHome: "lobby",
  theme: "/rer-theme.css", mark: "/rer-mark.svg", band: "/brand/band.svg",
};
