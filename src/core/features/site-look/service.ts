import { normaliseWebsite, readSite, type SiteRead, type SiteReadResult } from "../../platform/site-reader";
import { brandFontBytes, brandMarkBytes } from "./brand-limits";
import type { BrandFiles } from "./brand-files";
import { usedPalette } from "./contrast";
import { brandFile, markTypes } from "./public-look";
import type { SiteLookRepository } from "./repository";
import { iconRefusal, lookState } from "./state";
import { paletteRoles, type Overrides, type PaletteRole, type ReadError, type ReadPalette, type StoredColours, type StoredLook } from "./stored";

export class SiteLookError extends Error {
  constructor(readonly status: 400 | 409, readonly code: string, message: string) { super(message); }
}

const changed = () => new SiteLookError(409, "site_look_changed", "The look changed while this was saving. Reload and try again.");

/** The owner's change to one or more values: null puts a value back to what the site gave. */
export type LookChange = Partial<Record<PaletteRole | "name" | "line", string | null>> & { mark?: "site" | "none"; face?: "site" | "plain"; look?: "site" | "plain" };

/** What the read says about the site's face. Its font file is never kept: the licence is the file's own field (Google
 * Fonts when it names none and Google Fonts serves it), and a file that was not read makes no licence claim. */
function faceOf(site: SiteRead) {
  if (!site.face) return null;
  const { face } = site;
  const licence = face.licence ? face.licence.open ?? (face.source === "google-fonts" ? "Google Fonts" : face.licence.text?.slice(0, 200) ?? null) : null;
  return { family: face.family.slice(0, 120), licence, kind: face.kind, source: face.url, unread: face.unread };
}

/** The address as the reader would request it, for the record of a failed read. */
function attempted(input: string) {
  try { return normaliseWebsite(input).href; } catch { return input.trim().slice(0, 500); }
}

const withOverrides = (read: ReadPalette, overrides: Overrides): ReadPalette =>
  Object.fromEntries(paletteRoles.map((role) => [role, overrides.colours?.[role] ?? read[role]])) as ReadPalette;

const coloursFor = (read: ReadPalette, overrides: Overrides): StoredColours => ({ read, ...usedPalette(withOverrides(read, overrides)) });

/** BRAND-001 (ct C2): the booking page's look, read from the workspace's website only when asked, stored with its
 * time, changeable value by value, with the plain look when there is no site look to show. */
export class SiteLookService {
  constructor(
    private readonly repository: SiteLookRepository,
    private readonly files: BrandFiles,
    private readonly reader: (url: string) => Promise<SiteReadResult> = (url) =>
      readSite(url, { timeoutMs: 15_000, iconTypes: markTypes, maxIconBytes: brandMarkBytes, maxFontBytes: brandFontBytes }),
  ) {}

  async state() {
    return lookState(await this.repository.get());
  }

  /** Reads the website now. A failed read, or a site with no mark, colours or type, leaves the look as it was; only an
   * address that is not a web address at all is refused without a record. Whatever the owner set by hand stays: their
   * changes, a hidden mark or face, and the plain look if they chose it, until they put each back to the read value. */
  async read(input: string) {
    const previous = await this.repository.get();
    const result = await this.reader(input);
    if (!result.ok && result.reason === "invalid-url") throw new SiteLookError(400, "website_invalid", result.message);
    const at = new Date().toISOString();
    if (!result.ok) return this.failed(previous, { url: attempted(input), at, reason: result.reason, message: result.message });
    const { site } = result;
    const face = faceOf(site);
    if (!site.icon && paletteRoles.every((role) => site.palette[role] === null) && !face) {
      const message = site.iconRefused ? `That website gives no colours or type to read, and ${iconRefusal[site.iconRefused.reason]}.` : "That website gives no mark, colours or type to read.";
      return this.failed(previous, { url: site.url, at, reason: "nothing_found", message });
    }
    const markAsset = site.icon ? await this.files.put(site.icon.bytes, site.icon.contentType) : null;
    const overrides = previous?.overrides ?? {};
    const saved = await this.repository.saveRead(previous, {
      websiteUrl: site.url, readAt: at, name: site.name?.slice(0, 120) ?? null, line: site.description,
      markAsset, markSource: (site.icon?.url ?? site.iconRefused?.url)?.slice(0, 2000) ?? null, markUnread: site.iconRefused?.reason ?? null,
      fontFamily: face?.family ?? null, fontLicence: face?.licence ?? null, fontKind: face?.kind ?? null, fontSource: face?.source?.slice(0, 2000) ?? null, fontUnread: face?.unread ?? null,
      colours: coloursFor(site.palette, overrides), overrides,
      look: previous?.readAt && previous.look === "plain" ? "plain" : "site",
    });
    if (!saved) {
      await this.files.discard([markAsset], await this.currentFiles());
      throw changed();
    }
    await this.files.discard([previous?.markAsset ?? null], [markAsset, previous?.fontAsset ?? null]);
    await this.files.sweep([markAsset, previous?.fontAsset ?? null]);
    return this.state();
  }

  /** The owner's changes: which look shows, and any value on its own. */
  async change(change: LookChange) {
    const previous = await this.repository.get();
    if (!previous?.readAt || !previous.colours) {
      if (change.look === "plain" && Object.keys(change).length === 1) return this.state();
      throw new SiteLookError(409, "site_look_unread", "Read your website first.");
    }
    const overrides: Overrides = { ...previous.overrides, colours: { ...previous.overrides.colours } };
    for (const key of ["name", "line"] as const) {
      if (change[key] === null) delete overrides[key];
      else if (change[key] !== undefined) overrides[key] = change[key];
    }
    for (const role of paletteRoles) {
      if (change[role] === null) delete overrides.colours![role];
      else if (change[role] !== undefined) overrides.colours![role] = change[role];
    }
    if (!Object.keys(overrides.colours!).length) delete overrides.colours;
    if (change.mark === "none") overrides.mark = "none";
    if (change.mark === "site") delete overrides.mark;
    if (change.face === "plain") overrides.face = "plain";
    if (change.face === "site") delete overrides.face;
    const saved = await this.repository.saveChanges(previous, { look: change.look ?? previous.look, overrides, colours: coloursFor(previous.colours.read, overrides) });
    if (!saved) throw changed();
    return this.state();
  }

  /** Back to plain: forgets the read and the owner's changes, and removes the brand files. */
  async clear() {
    const previous = await this.repository.get();
    if (previous) {
      if (!await this.repository.remove(previous)) throw changed();
      await this.files.discard([previous.markAsset, previous.fontAsset], []);
      await this.files.sweep([]);
    }
    return this.state();
  }

  /** BRAND-002 (ct C3): a brand file is public only while the stored look holds it, and only in a brand type. */
  async publicFile(name: string) {
    const key = `brand/${name}`;
    const declared = brandFile(key);
    const stored = declared ? await this.repository.get() : null;
    if (!declared || !stored || (stored.markAsset !== key && stored.fontAsset !== key)) return null;
    const object = await this.files.get(key);
    return object && object.httpMetadata?.contentType === declared.contentType ? { object, contentType: declared.contentType } : null;
  }

  private async failed(previous: StoredLook | null, error: ReadError) {
    if (!await this.repository.saveFailure(previous, error)) throw changed();
    return this.state();
  }

  private async currentFiles() {
    const current = await this.repository.get();
    return [current?.markAsset ?? null, current?.fontAsset ?? null];
  }
}
