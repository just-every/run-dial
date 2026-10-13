import { segmentPath } from "./geometry";

type DialRingProps = { cx: number; cy: number; outer: number; inner: number; count?: number; gap: number; chosen: number | number[]; chosenClassName?: string; chosenFill?: string };

/** A ring of ink hour segments with golden chosen segments: the chosen time, or the steps done. Drawn inside an aria-hidden SVG. */
export function DialRing({ cx, cy, outer, inner, count = 12, gap, chosen, chosenClassName = "dial-chosen", chosenFill }: DialRingProps) {
  const step = 360 / count;
  return <g>
    {Array.from({ length: count }, (_, index) => <path key={index} className="dial-segment" d={segmentPath(cx, cy, outer, inner, index * step, (index + 1) * step, gap)} />)}
    {[chosen].flat().map((index) => <path key={`chosen-${index}`} className={chosenClassName} fill={chosenFill} d={segmentPath(cx, cy, outer, inner, index * step, (index + 1) * step, gap)} />)}
  </g>;
}
