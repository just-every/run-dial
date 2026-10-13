import type { ReactNode } from "react";
import { MiniDial } from "../../shared/drawing/MiniDial";
import { Card } from "./primitives";

/**
 * A calm card for an empty list or a page that could not load: a small waiting dial (or, for `tone="error"`, the dial with its
 * slot hatched and an ink "!"), the title, one sentence and the action.
 */
export function EmptyState({ title, description, action, tone = "empty" }: { title: string; description: string; action?: ReactNode; tone?: "empty" | "error" }) {
  return (
    <Card className="grid min-h-64 place-items-center p-8 text-center">
      <div className="max-w-md">
        <MiniDial size={64} state={tone === "error" ? "off" : "waiting"} className="mini-dial mx-auto mb-4" />
        <h2 className="text-2xl font-extrabold tracking-[-.02em] text-ink">{title}</h2>
        <p className="mt-2 text-[15px] leading-6 text-soft">{description}</p>
        {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
      </div>
    </Card>
  );
}
