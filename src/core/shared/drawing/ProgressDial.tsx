import { DialRing } from "./DialRing";
import { handPath } from "./geometry";

/**
 * Setup progress as a dial: `count` light segments, the first `done` of them gold, and a gold hand pointing at the next step
 * around the ink hub. Once every step is done the hand rests on the last one. Decorative.
 */
export function ProgressDial({ count, done, size, className = "" }: { count: number; done: number; size: number; className?: string }) {
  const finished = Math.min(done, count);
  const next = Math.min(finished, count - 1);
  return <svg className={`dial-art progress-dial ${className}`} viewBox="0 0 240 240" width={size} height={size} aria-hidden="true" focusable="false">
    <DialRing cx={120} cy={120} outer={112} inner={76} count={count} gap={12} chosen={Array.from({ length: finished }, (_, index) => index)} />
    <path className="dial-hand" d={handPath(120, 120, 64, 16, (next + 0.5) * (360 / count))} />
    <circle className="dial-hub" cx={120} cy={120} r={18} />
  </svg>;
}
