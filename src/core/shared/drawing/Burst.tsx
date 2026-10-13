import { burstLines } from "./geometry";

type BurstProps = { cx: number; cy: number; radius: number; length: number; degrees: number; spread?: number; fan?: number; lean?: number; className?: string };

/** The three-tick golden burst that marks a time clicking into place. */
export function Burst({ cx, cy, radius, length, degrees, spread, fan, lean, className = "burst" }: BurstProps) {
  return <g className={className}>
    {burstLines(cx, cy, radius, length, degrees, spread, fan, lean).map((line, index) => <line key={index} className={`burst-tick burst-tick--${index + 1}`} {...line} />)}
  </g>;
}
