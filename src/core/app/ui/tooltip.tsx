import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import "./tooltip.css";

const hoverDelay = 300;
const gap = 8;
const edge = 8;
// Just after a tip closes, the next control's tip opens at once, so moving along a row of controls never waits again.
let lastClosedAt = 0;

/**
 * The one tooltip for icon-only controls (H19). Its text is the control's accessible name: `label` becomes the control's
 * aria-label and the tip repeats it for sighted users. It opens 300 ms after a mouse or pen rests on the control, also while
 * the control is disabled, and at once on keyboard focus. Leaving, blurring, pressing, scrolling or Escape closes it; after a
 * press or an Escape it stays closed until the pointer leaves. It sits in the top layer above the control (below it when
 * there is no room), never over it, and never takes the pointer, so a tap or a click always reaches the control. A touch
 * shows nothing: a tap only acts. The wrapper lays out as its control alone (display: contents), from the first render.
 */
export function Tooltip({ label, children }: { label: string; children: ReactElement<{ "aria-label"?: string }> }) {
  const [open, setOpen] = useState<{ anchor: HTMLElement; by: "pointer" | "focus" }>();
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const quiet = useRef(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    const element = tip.current;
    if (!open || !element) return;
    if (!element.matches(":popover-open")) element.showPopover();
    place(open.anchor, element);
    const close = () => setOpen(undefined);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (open.by === "pointer") quiet.current = true;
      close();
    };
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      lastClosedAt = Date.now();
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const control = (event: SyntheticEvent<HTMLSpanElement>) => event.currentTarget.firstElementChild instanceof HTMLElement ? event.currentTarget.firstElementChild : null;
  const hide = () => { clearTimeout(timer.current); setOpen(undefined); };

  return <span style={{ display: "contents" }}
    onPointerEnter={(event) => {
      const anchor = control(event);
      if (!anchor || event.pointerType === "touch" || quiet.current) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setOpen({ anchor, by: "pointer" }), Date.now() - lastClosedAt < hoverDelay ? 0 : hoverDelay);
    }}
    onPointerLeave={(event) => { quiet.current = false; if (!control(event)?.matches(":focus-visible")) hide(); }}
    onPointerDown={() => { quiet.current = true; hide(); }}
    onFocus={(event) => { if (event.target === control(event) && event.target.matches(":focus-visible")) { clearTimeout(timer.current); setOpen({ anchor: event.target, by: "focus" }); } }}
    onBlur={hide}>
    {cloneElement(children, { "aria-label": label })}
    {open ? createPortal(<span ref={tip} className="dial-tooltip" popover="manual" aria-hidden="true">{label}</span>, document.body) : null}
  </span>;
}

/** Centres the tip above its control, or below it when there is no room above, and keeps it 8 px inside the viewport. */
function place(anchor: HTMLElement, tip: HTMLElement) {
  const box = anchor.getBoundingClientRect();
  const { width, height } = tip.getBoundingClientRect();
  const above = box.top - gap - height;
  const top = above >= edge ? above : box.bottom + gap;
  const left = Math.min(box.left + box.width / 2 - width / 2, document.documentElement.clientWidth - edge - width);
  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(Math.max(edge, left))}px`;
}
