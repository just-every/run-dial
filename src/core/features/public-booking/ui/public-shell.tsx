import { HostAvatar } from "../../host-profile";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties, type PropsWithChildren } from "react";
import { clientMount } from "../../../app/public-mount";
import type { PublicEvent, PublicProfile } from "./types";
import { BrandMark } from "./brand-mark";
import { Icon } from "../../../shared/drawing/icons";

export function PublicTheme({ children }: PropsWithChildren) {
  const { theme } = clientMount.deploymentConfig;
  const style = {
    "--dial-primary": theme.primary,
    "--dial-accent": theme.accent,
    "--dial-radius": theme.radius,
  } as CSSProperties & Record<string, string>;
  return <div className="pb-theme" style={style}>{children}</div>;
}

export function PublicHeader({ profilePath, embedded = false, step }: { profilePath?: string; embedded?: boolean; step?: 1 | 2 | 3 }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menuOpen]);
  return <header className={`pb-header ${step ? "" : "pb-header-simple"}`}>
    <Link className="pb-brand" to="/" reloadDocument aria-label="Dial home"><BrandMark />Dial</Link>
    {step ? <nav className="pb-progress" aria-label="Booking progress">{["Choose time", "Your details", "Confirmed"].map((label, index) => <span key={label} aria-current={step === index + 1 ? "step" : undefined}><b>{index + 1}</b>{label}</span>)}</nav> : null}
    <div className="pb-header-links"><a href={clientMount.deploymentConfig.privacyNoticeUrl} target={embedded ? "_blank" : undefined} rel={embedded ? "noreferrer" : undefined}>Privacy notice</a>{profilePath ? <a href={profilePath}>View availability</a> : null}</div>
    <button ref={menuButton} type="button" className="pb-menu-button" aria-expanded={menuOpen} aria-controls="public-navigation" onClick={() => setMenuOpen((open) => !open)}><span aria-hidden="true">☰</span> Menu</button>
    {menuOpen ? <nav className="pb-mobile-menu" id="public-navigation" aria-label="Public navigation"><a href={clientMount.deploymentConfig.privacyNoticeUrl} target={embedded ? "_blank" : undefined} rel={embedded ? "noreferrer" : undefined}>Privacy notice</a>{profilePath ? <a href={profilePath}>View availability</a> : null}</nav> : null}
  </header>;
}

export function PublicFooter({ embedded = false }: { embedded?: boolean }) {
  return <footer className="pb-footer"><a href={clientMount.deploymentConfig.privacyNoticeUrl} target={embedded ? "_blank" : undefined} rel={embedded ? "noreferrer" : undefined}>Your information is private</a>{clientMount.deploymentConfig.showPoweredBy ? <a href="https://runeditrun.com">Powered by Dial · runeditrun.com</a> : null}</footer>;
}

export function SessionSidebar({ profile, eventType, compact = false }: { profile: PublicProfile; eventType: PublicEvent; compact?: boolean }) {
  const quote = profile.socialProof[0];
  return <aside className={`pb-session ${compact ? "pb-session-compact" : ""}`} aria-label="Session details">
    <div className="pb-session-host"><HostAvatar name={profile.name} avatarKey={profile.avatarKey} className="pb-avatar" /><div><h2>{profile.name}</h2><p>{profile.title}</p></div></div>
    {!compact ? <div className="pb-session-body"><div><p className="pb-eyebrow">This session</p><h2>{eventType.title}</h2><p>{eventType.description}</p></div><dl><div><Icon name="clock" className="line-icon pb-fact-icon" /><dt>Duration</dt><dd>{eventType.durationMinutes} minutes</dd></div><div><Icon name="pin" className="line-icon pb-fact-icon" /><dt>Location</dt><dd>{eventType.locationLabel}</dd></div></dl>{quote ? <blockquote>“{quote.quote}”<cite>— {quote.attribution}</cite></blockquote> : null}<p className="pb-host-zone"><Icon name="user" className="line-icon pb-fact-icon" /><span>Host timezone <strong>{profile.timezone}</strong></span></p></div> : null}
  </aside>;
}
