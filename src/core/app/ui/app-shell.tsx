import { useHydrated } from "../use-hydrated";
import { OwnerEditorShell } from "../../features/editor/owner-editor";
import { useHostSetup } from "../../features/host-setup/ui/use-host-setup";
import { CopyBookingLink } from "../../features/host-setup/ui/copy-booking-link";
import type { BookingLink } from "../../features/host-setup/service";
import { Link, Outlet, useRouterState, useLoaderData } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { readProfile } from "../../features/host-profile/read-profile";
import { Button, buttonClassName } from "./primitives";
import { Icon, type IconName } from "../../shared/drawing/icons";
import { BrandMark } from "../../features/public-booking";
import { PlatformHealthProvider } from "../../features/host-setup/ui/platform-health";

const navigation: ReadonlyArray<readonly [string, string, IconName]> = [
  ["Overview", "/app", "home"],
  ["Bookings", "/app/bookings", "calendar"],
  ["Event types", "/app/event-types", "clock"],
  ["Availability", "/app/availability", "overrides"],
  ["Requests", "/app/requests", "mail"],
  ["Profile", "/app/profile", "user"],
  ["Settings", "/app/settings", "gear"],
];

type ProfileSummary = { name: string; title: string; handle: string };

export function AppShell() {
  return <PlatformHealthProvider><AppShellContent /></PlatformHealthProvider>;
}

function AppShellContent() {
  const hydrated = useHydrated();
  const setup = useHostSetup();
  const menuButton = useRef<HTMLButtonElement>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const initial = useLoaderData({ from: "/app" });
  const [profile, setProfile] = useState<ProfileSummary | null>(initial.profile ?? null);
  const [profileError, setProfileError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void api.api.app.profile.$get().then(readProfile).then((current) => {
      if (active) { setProfile(current); setProfileError(""); }
    }).catch((error: unknown) => {
      if (active) setProfileError(error instanceof Error ? error.message : "The host profile could not be loaded. Reload to try again.");
    });
    return () => { active = false; };
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menuOpen]);

  async function signOut() {
    window.dispatchEvent(new Event("dial:auth-lost"));
    await api.api.auth["sign-out"].$post();
    window.location.assign("/signin");
  }

  return (
    <div data-operator-ready={hydrated} className="min-h-screen bg-paper text-ink lg:grid lg:grid-cols-[19rem_minmax(0,1fr)]">
      {initial.editorConfigured ? <OwnerEditorShell /> : null}
      <div className="hidden border-r border-line bg-sidebar lg:block">
        <aside className="sticky top-0 flex h-screen flex-col overflow-y-auto px-5 py-6">
          <SidebarContent bookingLink={setup.state?.links[0]} pathname={pathname} profile={profile} profileError={profileError} onSignOut={signOut} />
        </aside>
      </div>
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-sidebar px-4 lg:hidden">
        <Link to="/app" className="inline-flex items-center gap-2 text-2xl font-extrabold tracking-[-.02em]"><BrandMark /><span data-rer-name>Dial</span></Link>
        <Button ref={menuButton} variant="secondary" className="min-h-9! px-4" type="button" aria-expanded={menuOpen} aria-controls="operator-mobile-navigation" onClick={() => setMenuOpen((open) => !open)}>
          Menu
        </Button>
        {menuOpen ? <div id="operator-mobile-navigation" className="absolute inset-x-4 top-[4.5rem] max-h-[calc(100dvh-5.5rem)] overflow-y-auto rounded-[20px] bg-card p-3 shadow-panel"><SidebarContent bookingLink={setup.state?.links[0]} pathname={pathname} profile={profile} profileError={profileError} onSignOut={signOut} onNavigate={() => { setMenuOpen(false); menuButton.current?.focus(); }} compact /></div> : null}
      </header>
      <main className="mx-auto w-full max-w-[1400px] px-4 py-7 sm:px-7 sm:py-10 lg:px-10"><Outlet /></main>
    </div>
  );
}

function SidebarContent({ bookingLink, pathname, profile, profileError, onSignOut, onNavigate, compact = false }: { bookingLink?: BookingLink; pathname: string; profile: ProfileSummary | null; profileError: string; onSignOut: () => Promise<void>; onNavigate?: () => void; compact?: boolean }) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {!compact ? <Link to="/app" className="mb-10 inline-flex items-center gap-2.5 text-[30px] font-extrabold leading-none tracking-[-.02em]"><BrandMark /><span data-rer-name>Dial</span></Link> : null}
      <div className={`${compact ? "mb-4" : "mb-8"} flex items-center gap-3 rounded-2xl bg-card p-3 shadow-lift`}>
        <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gold-wash text-[15px] font-extrabold text-ink">{initials(profile?.name ?? "Host")}</span>
        <div className="min-w-0"><p className="truncate text-[15px] font-bold">{profileError ? "Host unavailable" : profile?.name ?? "Host not configured"}</p><p className="truncate text-[13px] text-muted">{profile?.title ?? "Set up your host profile"}</p></div>
      </div>
      {profileError ? <p role="alert" className="mb-4 text-sm text-danger">{profileError}</p> : null}
      <nav aria-label="Operator navigation" className="grid gap-1">
        {navigation.map(([label, to, icon]) => {
          const active = to === "/app" ? pathname === "/app" : pathname === to || pathname.startsWith(`${to}/`);
          return <Link key={label} to={to} aria-current={active ? "page" : undefined} onClick={onNavigate} className={`flex min-h-11 items-center gap-3 rounded-[14px] px-3.5 text-[15px] leading-[1.2] transition-colors ${active ? "bg-gold-wash font-bold text-ink" : "font-[550] text-soft hover:bg-row"}`}>
            <span aria-hidden="true" className={`-ml-1 h-[7px] w-[7px] shrink-0 rounded-full ${active ? "bg-gold" : ""}`} />
            <Icon name={icon} className="line-icon h-5 w-5 text-ink" />{label}
          </Link>;
        })}
      </nav>
      {bookingLink ? <div className="mt-5 grid"><CopyBookingLink link={bookingLink} /></div> : null}
      <div className={`${compact ? "mt-4" : "mt-auto pt-6"} grid gap-3`}>
        {profile ? <Link to="/book/$handle" params={{ handle: profile.handle }} onClick={onNavigate} className={buttonClassName("secondary", "w-full")}>View booking page</Link> : null}
        <Button variant="secondary" className="w-full" type="button" onClick={() => void onSignOut()}>Sign out</Button>
      </div>
    </div>
  );
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}
