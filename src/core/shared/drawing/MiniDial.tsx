import { useId } from "react";
import { Burst } from "./Burst";
import { DialRing } from "./DialRing";
import { handPath } from "./geometry";

export type MiniDialState = "chosen" | "waiting" | "off";

/**
 * The hero dial in miniature: ring, golden slot, hand, hub and, once a time is chosen, the burst. "waiting" leaves the burst out;
 * "off" draws the slot with the landing's busy hatch and an ink "!" badge, for a time or a page that could not be kept. `size`
 * sets its width and height in pixels; without it the class sizes it.
 */
export function MiniDial({ chosen = 1, className = "mini-dial", size, state = "chosen" }: { chosen?: number; className?: string; size?: number; state?: MiniDialState }) {
  const degrees = chosen * 30 + 15;
  const hatch = `dial-hatch-${useId().replace(/:/g, "")}`;
  return <svg className={`dial-art ${className}`} viewBox="0 0 240 240" width={size} height={size} aria-hidden="true" focusable="false">
    {state === "off" ? <defs><pattern id={hatch} width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect className="dial-hatch-base" width="18" height="18" /><rect className="dial-hatch-tint" width="18" height="18" /><line className="dial-hatch-line" x1="0" y1="0" x2="0" y2="18" /></pattern></defs> : null}
    <DialRing cx={120} cy={128} outer={92} inner={54} gap={6} chosen={chosen} {...(state === "off" ? { chosenClassName: "dial-off", chosenFill: `url(#${hatch})` } : {})} />
    <path className="dial-hand" d={handPath(120, 128, 74, 15, degrees)} />
    <circle className="dial-hub" cx={120} cy={128} r={12} />
    {state === "chosen" ? <Burst cx={120} cy={128} radius={100} length={18} degrees={degrees} spread={14} /> : null}
    {state === "off" ? <g><circle className="dial-badge" cx={196} cy={198} r={38} /><rect className="dial-badge-glyph" x={190} y={173} width={12} height={33} rx={6} /><circle className="dial-badge-glyph" cx={196} cy={219} r={7} /></g> : null}
  </svg>;
}
