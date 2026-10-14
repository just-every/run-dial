import { useEffect, useRef, type ReactNode, type KeyboardEvent } from "react";
import { Button } from "./primitives";

/** Native modal supplies focus containment; close restores the actual opener. */
export function FocusDialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current!;
    element.showModal();
    element.querySelector("button")?.focus();
    return () => { element.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={dialog} onKeyDown={containFocus} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-auto max-h-[90dvh] w-[min(46rem,calc(100%_-_2rem))] overflow-auto rounded-[22px] bg-card p-0 text-ink shadow-panel backdrop:bg-ink/40">
    <div className="flex items-center justify-between gap-4 bg-gold-wash px-5 py-4"><h2 className="text-[19px] font-[750] tracking-[-.01em]">{title}</h2><Button type="button" variant="secondary" onClick={onClose}>Close</Button></div><div className="p-5">{children}</div>
  </dialog>;
}

function containFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]")]
    .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
  const first = controls[0], last = controls.at(-1);
  if (!first) { event.preventDefault(); event.currentTarget.focus(); return; }
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
