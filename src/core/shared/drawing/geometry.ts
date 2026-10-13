// Dial geometry shared by the drawings. Angles are degrees clockwise from 12 o'clock; paths are rounded to two decimals so the
// server and the browser render identical markup.

const round = (value: number) => Math.round(value * 100) / 100;

/** The point `radius` from (cx, cy) at `degrees` clockwise from 12 o'clock. */
function polar(cx: number, cy: number, radius: number, degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [round(cx + radius * Math.sin(radians)), round(cy - radius * Math.cos(radians))];
}

/**
 * One segment of a ring between two angles, with a straight gap of `gap` units on each side, so the gaps between neighbouring
 * segments keep one width from the inner edge to the outer one, like the cuts in a printed dial.
 */
export function segmentPath(cx: number, cy: number, outer: number, inner: number, from: number, to: number, gap: number) {
  const offset = (radius: number) => (Math.asin(gap / 2 / radius) * 180) / Math.PI;
  const [o0, o1] = [polar(cx, cy, outer, from + offset(outer)), polar(cx, cy, outer, to - offset(outer))];
  const [i1, i0] = [polar(cx, cy, inner, to - offset(inner)), polar(cx, cy, inner, from + offset(inner))];
  return `M${o0.join(" ")}A${outer} ${outer} 0 0 1 ${o1.join(" ")}L${i1.join(" ")}A${inner} ${inner} 0 0 0 ${i0.join(" ")}Z`;
}

/** A tapered hand from the centre to `length`, pointing at `degrees`, `width` across at its base. */
export function handPath(cx: number, cy: number, length: number, width: number, degrees: number) {
  const tip = polar(cx, cy, length, degrees);
  const left = polar(cx, cy, width / 2, degrees - 90);
  const right = polar(cx, cy, width / 2, degrees + 90);
  const tail = polar(cx, cy, width / 3, degrees + 180);
  return `M${left.join(" ")}L${tip.join(" ")}L${right.join(" ")}L${tail.join(" ")}Z`;
}

/**
 * Three short ticks beyond `radius` around `degrees`: the golden click. Each starts `spread` degrees apart on the circle and
 * points `fan` times further apart than that, turned by `lean` overall, so the ticks open like a small spark.
 */
export function burstLines(cx: number, cy: number, radius: number, length: number, degrees: number, spread = 13, fan = 2, lean = 0) {
  return [-spread, 0, spread].map((turn) => {
    const [x1, y1] = polar(cx, cy, radius, degrees + turn);
    const [x2, y2] = polar(x1, y1, length, degrees + lean + turn * fan);
    return { x1, y1, x2, y2 };
  });
}
