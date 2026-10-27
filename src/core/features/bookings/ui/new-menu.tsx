import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button, buttonClassName } from "../../../app/ui/primitives";
import { useHydrated } from "../../../app/use-hydrated";
import { Icon } from "../../../shared/drawing/icons";
import "./new-menu.css";

/** One stable starting place for one-off bookings, times, polls and links. */
export function NewBookingMenu() {
  const id = useId();
  const hydrated = useHydrated();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  function place() {
    const button = trigger.current, panel = menu.current;
    if (!button || !panel) return;
    const bounds = button.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(bounds.right - 256, window.innerWidth - 264))}px`;
    panel.style.top = `${bounds.bottom + 8}px`;
  }

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  function show(index = 0) {
    place();
    setActive(index);
    menu.current?.showPopover();
    setOpen(true);
    menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[index]?.focus();
  }

  function close(restoreFocus = true) {
    menu.current?.hidePopover();
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  function move(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") { close(); return; }
    const next = event.key === "ArrowDown" ? (active + 1) % 4 : event.key === "ArrowUp" ? (active + 3) % 4 : event.key === "Home" ? 0 : event.key === "End" ? 3 : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
    menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[next]?.focus();
  }

  const rowClass = "flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold text-ink hover:bg-gold-wash focus-visible:bg-gold-wash focus-visible:outline-3 focus-visible:outline-ink focus-visible:outline-offset-[-3px]";

  return <span className="inline-grid">
    {/* Retain the existing header space so the shorter label never moves the page. */}
    <span aria-hidden="true" className={buttonClassName("primary", "pointer-events-none invisible col-start-1 row-start-1")}>Create booking</span>
    <Button className="col-start-1 row-start-1 justify-self-end" ref={trigger} type="button" disabled={!hydrated} aria-label="New" aria-haspopup="menu" aria-expanded={open} aria-controls={id}
      onClick={() => open ? close() : show()}
      onKeyDown={event => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        show(event.key === "ArrowUp" ? 3 : 0);
      }}><span aria-hidden="true">+</span> New <span aria-hidden="true">⌄</span></Button>
    <div ref={menu} id={id} popover="auto" role="menu" tabIndex={-1} aria-label="New booking actions" onKeyDown={move}
      onToggle={event => setOpen(event.newState === "open")} className="dial-bookings-new-menu rounded-[22px] bg-card p-2 text-ink shadow-panel">
      <Link to="/app/bookings/new" role="menuitem" tabIndex={active === 0 ? 0 : -1} className={rowClass} onFocus={() => setActive(0)} onClick={() => close(false)}><Icon name="calendar" className="line-icon h-5 w-5" />New booking</Link>
      <Link to="/app/bookings/new/offer" role="menuitem" tabIndex={active === 1 ? 0 : -1} className={rowClass} onFocus={() => setActive(1)} onClick={() => close(false)}><Icon name="clock" className="line-icon h-5 w-5" />Offer specific times</Link>
      <Link to="/app/bookings" search={() => ({ view: "polls" })} role="menuitem" tabIndex={active === 2 ? 0 : -1} className={rowClass} onFocus={() => setActive(2)} onClick={() => close(false)}><Icon name="people" className="line-icon h-5 w-5" />Meeting poll</Link>
      <Link to="/app/bookings/new/private-link" role="menuitem" tabIndex={active === 3 ? 0 : -1} className={rowClass} onFocus={() => setActive(3)} onClick={() => close(false)}><Icon name="link" className="line-icon h-5 w-5" />Private link</Link>
    </div>
  </span>;
}
