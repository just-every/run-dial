import { brandFile, publicLook, siteHost, siteLook, type BrandFile, type PublicLook } from "./public-look";
import { openFaceLicences, type Adjustment, type Overrides, type ReadPalette, type StoredLook } from "./stored";

/** Why the look shown is the one shown. */
export type LookBecause = "read" | "chosen" | "none" | "read_failed" | "nothing_found";

export type LookNote =
  | { code: "face_licence" | "face_unread"; family: string; licence: string | null; message: string }
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
  /** What the site gave, before the owner's changes and the rules. */
  read: {
    name: string | null;
    line: string | null;
    mark: BrandFile | null;
    colours: ReadPalette;
    face: { family: string; licence: string | null; usable: boolean; file: BrandFile | null } | null;
  } | null;
  overrides: Overrides;
  /** The site's look as booking pages wear it when it is chosen. */
  siteLook: PublicLook | null;
  /** What booking pages wear now: the site's look or the plain look. */
  shown: PublicLook;
  /** Why something read is not used as read: the face's licence, and colours adjusted for contrast. */
  notes: LookNote[];
}

const nothingFound = "nothing_found";

export function lookState(stored: StoredLook | null): SiteLookState {
  const site = siteLook(stored);
  const read = stored?.readAt ? stored : null;
  const failed = stored?.readError ?? null;
  const shown = publicLook(stored);
  return {
    look: shown.kind,
    because: shown.kind === "site" ? "read" : !stored ? "none" : read ? "chosen" : failed?.reason === nothingFound ? "nothing_found" : failed ? "read_failed" : "none",
    website: read?.websiteUrl && read.readAt ? { url: read.websiteUrl, host: siteHost(read.websiteUrl), readAt: read.readAt } : null,
    lastRead: failed ? { ok: false, ...failed } : read?.websiteUrl && read.readAt ? { ok: true, url: read.websiteUrl, at: read.readAt } : null,
    read: read && read.colours ? {
      name: read.name,
      line: read.line,
      mark: brandFile(read.markAsset),
      colours: read.colours.read,
      face: read.fontFamily ? { family: read.fontFamily, licence: read.fontLicence, usable: read.fontAsset !== null, file: brandFile(read.fontAsset) } : null,
    } : null,
    overrides: stored?.overrides ?? {},
    siteLook: site,
    shown,
    notes: read ? notes(read) : [],
  };
}

function notes(read: StoredLook): LookNote[] {
  const result: LookNote[] = [];
  if (read.fontFamily && !read.fontAsset) {
    const family = read.fontFamily, licence = read.fontLicence;
    if (licence && openFaceLicences.includes(licence)) {
      result.push({ code: "face_unread", family, licence, message: `${family}'s font file could not be read, so booking pages keep the plain look's type.` });
    } else {
      result.push({ code: "face_licence", family, licence, message: licence
        ? `${family}'s own licence is not OFL or Apache and it is not a Google Fonts family, so booking pages keep the plain look's type.`
        : `${family} names no open licence (OFL or Apache) and is not a Google Fonts family, so booking pages keep the plain look's type.` });
    }
  }
  if (read.colours?.adjusted.length) result.push({ code: "contrast", adjusted: read.colours.adjusted, message: "Adjusted for contrast" });
  return result;
}
