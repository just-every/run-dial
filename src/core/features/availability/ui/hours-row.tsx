import type { ReactNode } from "react";
import { IconTile } from "../../../app/ui/primitives";
import type { IconName } from "../../../shared/drawing/icons";

/** Native disclosures keep their open state and keyboard focus during saves. */
export function HoursRow({ title, summary, icon = "clock", children }: { title: string; summary: string; icon?: IconName; children: ReactNode }) {
  return <details className="group/hours-row min-w-0">
    <summary className="flex min-h-[76px] cursor-pointer list-none items-center gap-3 px-5 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-ink sm:px-6">
      <IconTile icon={icon} />
      <span className="min-w-0 flex-1"><span className="block text-[16px] font-bold">{title}</span><span className="mt-0.5 block text-sm text-soft">{summary}</span></span>
      <span aria-hidden="true" className="text-xl transition-transform group-open/hours-row:rotate-90">›</span>
    </summary>
    <div className="min-w-0 px-5 pb-5 sm:px-6">{children}</div>
  </details>;
}
