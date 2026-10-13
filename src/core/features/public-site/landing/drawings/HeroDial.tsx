import { Burst } from "../../../../shared/drawing/Burst";
import { DialRing } from "../../../../shared/drawing/DialRing";
import { handPath } from "../../../../shared/drawing/geometry";

const cx = 372, cy = 404;

/**
 * The hero: a bold ink ring of twelve hour segments whose golden hand has clicked onto one golden slot, and the booked meeting
 * that slot became. Decorative; the headline beside it says the same thing in words. motion.css plays the click once on load.
 */
export function HeroDial() {
  return <svg className="hero-dial" viewBox="16 22 744 876" aria-hidden="true" focusable="false">
    <DialRing cx={cx} cy={cy} outer={340} inner={198} gap={15} chosen={1} />
    <g className="hero-hand"><path className="dial-hand" d={handPath(cx, cy, 268, 48, 45)} /></g>
    <circle className="dial-hub" cx={cx} cy={cy} r={40} />
    <Burst cx={cx} cy={cy} radius={356} length={44} degrees={45} spread={10} fan={1} />
    <g transform="translate(525 758) rotate(-10)">
      <g className="hero-card">
        <rect className="card-halo" x={-190} y={-78} width={372} height={156} rx={38} />
        <rect className="card-halo" x={-174} y={-60} width={372} height={156} rx={38} />
        <rect className="card-plate" x={-160} y={-46} width={344} height={128} rx={24} />
        <rect className="card-face" x={-176} y={-64} width={344} height={128} rx={24} />
        <circle className="card-dot" cx={-120} cy={0} r={26} />
        <text className="card-time" x={-78} y={-2}>10:00 AM</text>
        <text className="card-label" x={-77} y={29}>MEETING</text>
        <g transform="translate(96 -26)">
          <rect className="card-icon" x={0} y={6} width={50} height={46} rx={9} />
          <rect className="card-icon" x={11} y={0} width={7} height={14} rx={3.5} />
          <rect className="card-icon" x={32} y={0} width={7} height={14} rx={3.5} />
          <path className="card-check" d="M14 30l8 8 14-15" />
        </g>
      </g>
    </g>
  </svg>;
}
