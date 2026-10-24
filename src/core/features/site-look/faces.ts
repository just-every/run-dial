import type { FaceKind } from "../../platform/site-reader";

/** A face Dial ships under an open licence, served from Dial's own files. */
export interface BundledFace {
  family: string;
  kind: FaceKind;
  licence: "OFL" | "Apache-2.0";
  file: { url: string; contentType: "font/woff2" };
}

/** BRAND-001 (ct, 24 Oct): the site's font file is never copied. Booking pages set their text in the face nearest
 * the site's own from this set, or in the plain stack when none is near. The set is the open faces Dial ships; a face
 * joins it with its file and its licence under public/fonts/. */
export const bundledFaces: readonly BundledFace[] = [
  { family: "Figtree", kind: "sans", licence: "OFL", file: { url: "/fonts/figtree-latin-wght-normal.woff2", contentType: "font/woff2" } },
];

/** The face booking pages show for a read face, and why: Dial bundles the same family, or a face of the same kind. */
export interface ShownFace extends Omit<BundledFace, "kind"> { match: "family" | "kind" }

/** The bundled face nearest a read family: the same family when Dial bundles it, else one of the same kind; null when
 * none is near, and booking pages use the plain stack. */
export function nearestFace(family: string, kind: FaceKind | null): ShownFace | null {
  const same = bundledFaces.find((face) => face.family.toLowerCase() === family.toLowerCase());
  const near = same ?? (kind ? bundledFaces.find((face) => face.kind === kind) : undefined);
  return near ? { family: near.family, licence: near.licence, file: near.file, match: same ? "family" : "kind" } : null;
}
