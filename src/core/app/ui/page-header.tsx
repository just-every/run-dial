import type { ReactNode } from "react";
import type { IconName } from "../../shared/drawing/icons";
import { IconTile } from "./primitives";

/**
 * The page's eyebrow, title and description, with its actions as pills on the right. `art` is a decorative spot drawing: beside
 * the actions on wide screens and beside the title on phones. `titleArt` sits before the title (First run's progress dial) from 640px; on phones the title
 * keeps the full width.
 */
export function PageHeader({ eyebrow, title, description, actions, art, titleArt }: { eyebrow?: string; title: string; description: string; actions?: ReactNode; art?: ReactNode; titleArt?: ReactNode }) {
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-5 gap-y-5 border-b border-line-soft pb-7 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <p className="mb-2 text-xs font-bold uppercase leading-[1.2] tracking-[.12em] text-muted">{eyebrow}</p> : null}
        <div className={titleArt ? "flex items-center gap-4" : undefined}>
          {titleArt ? <span className="hidden sm:contents">{titleArt}</span> : null}
          <h1 className="text-[34px] font-extrabold leading-[1.05] tracking-[-.02em] text-ink sm:text-[40px]">{title}</h1>
        </div>
        <p className="mt-3 text-[17px] leading-[1.55] text-soft">{description}</p>
      </div>
      {art ? <div className="shrink-0 sm:self-center">{art}</div> : <span className="hidden sm:block" />}
      {actions ? <div className="col-span-2 flex shrink-0 flex-wrap gap-2 sm:col-span-1">{actions}</div> : null}
    </header>
  );
}

/** A card's title row: an optional icon tile, the title and its description, and an optional action on the right. */
export function SectionHeading({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: IconName }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <IconTile icon={icon} /> : null}
        <div className={`min-w-0 ${icon ? "pt-2" : ""}`}>
          <h2 className="text-[19px] font-[750] leading-[1.25] tracking-[-.01em] text-ink">{title}</h2>
          {description ? <p className="mt-1 text-sm leading-6 text-soft">{description}</p> : null}
        </div>
      </div>
      {action ? <div className={`shrink-0 ${icon ? "pt-1.5" : ""}`}>{action}</div> : null}
    </div>
  );
}
