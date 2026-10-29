import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./primitives";
import { Tooltip } from "./tooltip";
import "./sheet.css";

/** A route's settings stay above their event; leaving is handled by the shared save guard. */
export function Sheet({ title, closeLabel, returnFocusId, onClose, children }: { title: string; closeLabel: string; returnFocusId: string; onClose(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previous;
      requestAnimationFrame(() => document.getElementById(returnFocusId)?.focus());
    };
  }, [returnFocusId]);
  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialog} className="event-sheet" aria-labelledby="event-sheet-heading" onCancel={event => { event.preventDefault(); close.current(); }}>
    <div className="event-sheet-surface">
      <header className="event-sheet-header"><h2 id="event-sheet-heading" className="text-[26px] font-extrabold leading-tight tracking-[-.02em]">{title}</h2><Tooltip label={closeLabel}><Button type="button" variant="secondary" className="h-11 w-11 shrink-0 p-0 text-2xl" onClick={() => close.current()}>×</Button></Tooltip></header>
      <div className="event-sheet-content">{children}</div>
    </div>
  </dialog>, document.body);
}
