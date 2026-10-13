import { PublicFooter, PublicHeader, PublicTheme } from "./public-shell";

export function PublicPrivacyPage() {
  return <PublicTheme><PublicHeader /><main className="pb-recovery"><section><p className="pb-eyebrow">Privacy notice</p><h1>Your information stays with this deployment.</h1><p>Dial does not use analytics or phone home. This scheduling deployment keeps only the information an operator or invitee deliberately submits in order to provide scheduling.</p><p>If booking or request delivery is unavailable, no submission is accepted. Contact the host directly for questions about information they control.</p></section></main><PublicFooter /></PublicTheme>;
}
