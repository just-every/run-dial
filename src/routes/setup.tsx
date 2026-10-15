import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { loadSetupShell } from "../core/app/loaders";
import { api } from "../core/api/client";
import { Button } from "../core/app/ui/primitives";
import { BrandMark } from "../core/features/public-booking";

const setupLink = "inline-flex min-h-11 items-center text-[15px] font-semibold text-ink decoration-[1.5px] underline-offset-[7px] hover:underline hover:decoration-gold-deep aria-[current=page]:underline aria-[current=page]:decoration-gold-deep";

export const Route = createFileRoute('/setup')({ codeSplitGroupings: [], beforeLoad: async () => ({ shell: await loadSetupShell() }), component: SetupShell });
function SetupShell() {
  async function signOut() {
    // Stop the private health check before native sign-out revokes its session.
    window.dispatchEvent(new Event("dial:auth-lost"));
    await api.api.auth["sign-out"].$post();
    window.location.assign("/signin");
  }
  return <div className="min-h-screen bg-paper text-ink"><header className="border-b border-line bg-sidebar px-4 py-3 sm:px-7"><nav aria-label="Setup navigation" className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-0 sm:gap-y-2"><Link to="/setup" className="mr-auto inline-flex min-h-11 items-center gap-2 text-2xl font-extrabold tracking-[-.02em]"><BrandMark /><span data-rer-name>Dial</span> <span className="text-[15px] font-semibold tracking-normal text-muted">setup</span></Link><div className="order-last flex w-full gap-6 sm:order-none sm:w-auto"><Link to="/setup/profile" className={setupLink}>Profile</Link><Link to="/setup/settings" className={setupLink}>Settings</Link><Link to="/setup/event-types" className={setupLink}>Event types</Link></div><Button type="button" variant="secondary" className="min-h-10!" onClick={() => void signOut()}>Sign out</Button></nav></header><main className="mx-auto w-full max-w-[1400px] px-4 py-7 sm:px-7"><Outlet /></main></div>;
}
