import type { FaceKind, FaceUnread, IconRefusal } from "../../platform/site-reader";
import { brandFontBytes, brandMarkBytes } from "./brand-limits";
import { nearestFace } from "./faces";
import { brandFile, publicLook, siteHost, siteLook, type BrandFile, type PublicLook } from "./public-look";
import type { Adjustment, Overrides, ReadPalette, StoredLook } from "./stored";

/** Why the look shown is the one shown. */
export type LookBecause = "read" | "chosen" | "none" | "read_failed" | "nothing_found";

/** Why something read is not used as read, each with its true reason. */
export type LookNote =
  | { code: "face_shown"; family: string; kind: FaceKind | null; shows: string; match: "family" | "kind"; message: string }
  | { code: "face_plain"; family: string; kind: FaceKind | null; because: "none_near" | "chosen"; message: string }
  | { code: "face_unread"; family: string; reason: FaceUnread; message: string }
  | { code: "mark_unread"; source: string; reason: IconRefusal; message: string }
  | { code: "contrast"; adjusted: Adjustment[]; message: string };

/** Everything Settings shows about the booking page's look (GET /api/app/site-look). */
export interface SiteLookState {
  /** What booking pages show now. */
  look: "site" | "plain";
  because: LookBecause;
  /** The site the stored look was read from, and when. */
  website: { url: string; host: string; readAt: string } | null;
  /** The last read asked for, which may have failed while an earlier look stays. */
  lastRead: { ok: true; url: string; at: string } | { ok: false; url: string; at: string; reason: string; message: string } | null;
  /** What the site gave, before the owner's changes and the rules. The face is described, never copied. */
  read: {
    name: string | null;
    line: string | null;
    /** The stored mark, with the address it was read from. */
    mark: (BrandFile & { source: string }) | null;
    colours: ReadPalette;
    /** `licence` is null when the face's file was not read (`unread` says why). */
    face: { family: string; kind: FaceKind | null; licence: string | null; source: string | null; unread: FaceUnread | null } | null;
  } | null;
  overrides: Overrides;
  /** The site's look as booking pages wear it when it is chosen. */
  siteLook: PublicLook | null;
  /** What booking pages wear now: the site's look or the plain look. */
  shown: PublicLook;
  /** Which face shows and why, what of the site could not be read, and colours adjusted for contrast. */
  notes: LookNote[];
}

const nothingFound = "nothing_found";

export function lookState(stored: StoredLook | null): SiteLookState {
  const site = siteLook(stored);
  const read = stored?.readAt ? stored : null;
  const failed = stored?.readError ?? null;
  const shown = publicLook(stored);
  const mark = brandFile(read?.markAsset ?? null);
  return {
    look: shown.kind,
    because: shown.kind === "site" ? "read" : !stored ? "none" : read ? "chosen" : failed?.reason === nothingFound ? "nothing_found" : failed ? "read_failed" : "none",
    website: read?.websiteUrl && read.readAt ? { url: read.websiteUrl, host: siteHost(read.websiteUrl), readAt: read.readAt } : null,
    lastRead: failed ? { ok: false, ...failed } : read?.websiteUrl && read.readAt ? { ok: true, url: read.websiteUrl, at: read.readAt } : null,
    read: read && read.colours ? {
      name: read.name,
      line: read.line,
      mark: mark && read.markSource ? { ...mark, source: read.markSource } : null,
      colours: read.colours.read,
      face: read.fontFamily ? { family: read.fontFamily, kind: read.fontKind, licence: read.fontLicence, source: read.fontSource, unread: read.fontUnread } : null,
    } : null,
    overrides: stored?.overrides ?? {},
    siteLook: site,
    shown,
    notes: read ? notes(read) : [],
  };
}

const kindWords: Record<FaceKind, string> = { sans: "sans-serif", serif: "serif", mono: "monospace", display: "display", script: "script" };
const megabytes = (bytes: number) => `${Number((bytes / 1_000_000).toFixed(1))} MB`;
const kilobytes = (bytes: number) => `${Math.round(bytes / 1_000)} KB`;

const faceUnread: Record<FaceUnread, (family: string) => string> = {
  "too-large": (family) => `${family}'s font file is over ${megabytes(brandFontBytes)}, so it was not read and its licence is unknown.`,
  unreachable: (family) => `${family}'s font file could not be fetched, so its licence is unknown.`,
  "not-a-font": (family) => `${family}'s font file is not a font Dial can read, so its licence is unknown.`,
  "no-file": (family) => `Your site's stylesheet names no file for ${family}, so its licence is unknown.`,
};

/** Why the site's icon is not the mark. */
export const iconRefusal: Record<IconRefusal, string> = {
  "too-large": `its icon is over ${kilobytes(brandMarkBytes)}`,
  unreachable: "its icon could not be fetched",
  "not-an-image": "its icon is not an image Dial can read",
  type: "its icon is in an image format booking pages don't use",
};

function notes(read: StoredLook): LookNote[] {
  const result: LookNote[] = [];
  if (read.fontFamily) {
    const family = read.fontFamily, kind = read.fontKind;
    if (read.fontUnread) result.push({ code: "face_unread", family, reason: read.fontUnread, message: faceUnread[read.fontUnread](family) });
    const near = nearestFace(family, kind);
    if (read.overrides.face === "plain") {
      result.push({ code: "face_plain", family, kind, because: "chosen", message: "You chose the plain stack for booking pages." });
    } else if (near) {
      result.push({ code: "face_shown", family, kind, shows: near.family, match: near.match, message: near.match === "family"
        ? `Booking pages use Dial's own open copy of ${near.family} (${near.licence}); your site's font file is not copied.`
        : `${family} is a ${kindWords[kind!]} face. Booking pages use ${near.family} (${near.licence}), the nearest open face Dial bundles; your site's font file is not copied.` });
    } else {
      result.push({ code: "face_plain", family, kind, because: "none_near", message: kind
        ? `${family} is a ${kindWords[kind]} face and Dial bundles none near it, so booking pages use the plain stack.`
        : `Dial can't tell what kind of face ${family} is, so booking pages use the plain stack.` });
    }
  }
  if (!read.markAsset && read.markSource && read.markUnread) result.push({ code: "mark_unread", source: read.markSource, reason: read.markUnread, message: `No mark from your site: ${iconRefusal[read.markUnread]}.` });
  if (read.colours?.adjusted.length) result.push({ code: "contrast", adjusted: read.colours.adjusted, message: "Adjusted for contrast" });
  return result;
}
