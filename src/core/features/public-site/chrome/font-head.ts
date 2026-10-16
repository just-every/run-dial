import fonts from "./fonts.css?url";
import figtreeLatin from "../fonts/figtree/figtree-latin-wght-normal.woff2?url&no-inline";

/** Figtree's @font-face rules, linked once from the root document head so route changes never recreate them (an imported component stylesheet is dropped after hydration in dev, and the font flashes). */
export const fontStylesheet = { rel: "stylesheet", href: fonts };

/** Preloads the primary file for public-site and operator pages; booking pages load it through the stylesheet alone. */
export const primaryFontPreload = { rel: "preload", as: "font", type: "font/woff2", href: figtreeLatin, crossOrigin: "anonymous" } as const;
