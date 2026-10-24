import type { Adjustment, Palette, PaletteRole, ReadPalette } from "./stored";

/** The plain look's ink and paper: what a role falls back to. */
export const ink = "#1d1c1a";
export const paper = "#ffffff";
export const plainPalette: Palette = { background: paper, ink, accent: ink, buttonInk: paper };

/** Text, page text and button labels alike, needs 4.5:1 (WCAG 1.4.3); a button against its page needs 3:1 (WCAG 1.4.11). */
const textContrast = 4.5;
const buttonContrast = 3;

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Ink or paper, whichever stands out more against the colour. */
const clearest = (against: string) => contrastRatio(ink, against) >= contrastRatio(paper, against) ? ink : paper;

/** Q10: the colours booking pages use. A pair that fails contrast for text (4.5:1) or a button (3:1) is replaced by
 * ink and paper for that role, and each replaced colour is recorded; a role the site did not give takes the plain
 * look's colour that works, which is not an adjustment. */
export function usedPalette(read: ReadPalette): { used: Palette; adjusted: Adjustment[] } {
  const adjusted = new Map<PaletteRole, Adjustment>();
  const replace = (role: PaletteRole, value: string) => {
    const given = read[role];
    if (given && given !== value) adjusted.set(role, { role, read: given, used: value });
    else adjusted.delete(role);
    return value;
  };

  let background = read.background ?? paper;
  let text = read.ink ?? clearest(background);
  if (contrastRatio(text, background) < textContrast) {
    const replacement = clearest(background);
    if (contrastRatio(replacement, background) >= textContrast) text = replace("ink", replacement);
    else { background = replace("background", paper); text = replace("ink", ink); }
  }

  let accent = read.accent ?? clearest(background);
  if (contrastRatio(accent, background) < buttonContrast) accent = replace("accent", clearest(background));

  let label = read.buttonInk ?? clearest(accent);
  if (contrastRatio(label, accent) < textContrast) {
    const replacement = clearest(accent);
    if (contrastRatio(replacement, accent) >= textContrast) label = replace("buttonInk", replacement);
    else {
      accent = replace("accent", clearest(background));
      label = replace("buttonInk", accent === ink ? paper : ink);
    }
  }
  return { used: { background, ink: text, accent, buttonInk: label }, adjusted: [...adjusted.values()] };
}
