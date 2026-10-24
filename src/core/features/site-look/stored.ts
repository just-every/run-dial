import type { FaceKind, FaceUnread, IconRefusal } from "../../platform/site-reader";

/** The colour roles of a look: the page, its text, its buttons and their text. */
export const paletteRoles = ["background", "ink", "accent", "buttonInk"] as const;
export type PaletteRole = typeof paletteRoles[number];
export type Palette = Record<PaletteRole, string>;
export type ReadPalette = Record<PaletteRole, string | null>;

/** A colour the booking pages do not use as read or chosen, because its pair failed contrast. */
export interface Adjustment { role: PaletteRole; read: string; used: string }
export interface StoredColours { read: ReadPalette; used: Palette; adjusted: Adjustment[] }

/** The owner's changes, value by value; an absent key means "as the site gave it". */
export interface Overrides { name?: string; line?: string; colours?: Partial<Palette>; mark?: "none"; face?: "plain" }

export interface ReadError { url: string; at: string; reason: string; message: string }

export interface StoredLook {
  id: string;
  /** The page the stored look was read from; null until a read succeeds. */
  websiteUrl: string | null;
  readAt: string | null;
  readError: ReadError | null;
  name: string | null;
  line: string | null;
  /** The read mark's R2 key (brand/<sha256>.<ext>), public under /media/brand/ while this look holds it. */
  markAsset: string | null;
  /** Where the mark was read; without a mark, the icon the site offered that could not be kept. */
  markSource: string | null;
  /** Why no mark was kept from `markSource`; null when the mark was kept or the site offers none. */
  markUnread: IconRefusal | null;
  /** A face file the owner uploads with its licence confirmed (a later round). A read never stores the site's own. */
  fontAsset: string | null;
  fontFamily: string | null;
  /** The read face's own licence: OFL, Apache-2.0 or Google Fonts, else its licence field's text; null when its file was not read. */
  fontLicence: string | null;
  fontKind: FaceKind | null;
  /** Where the site serves the face's file; it is never copied. */
  fontSource: string | null;
  /** Why the face's file was not read; null when it was. */
  fontUnread: FaceUnread | null;
  colours: StoredColours | null;
  overrides: Overrides;
  look: "site" | "plain";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export const selectStoredLook = "SELECT id, website_url, read_at, read_error, name, line, mark_asset, mark_source, mark_unread, font_asset, font_family, font_licence, font_kind, font_source, font_unread, colours_json, overrides_json, look, revision, created_at, updated_at FROM site_looks WHERE singleton_key = 'default'";

type Row = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value : null;
const json = <T>(value: unknown): T | null => {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value) as T; } catch { return null; }
};

export function storedLook(row: Row | undefined | null): StoredLook | null {
  if (!row) return null;
  const colours = json<StoredColours>(row.colours_json);
  return {
    id: String(row.id),
    websiteUrl: text(row.website_url),
    readAt: text(row.read_at),
    readError: json<ReadError>(row.read_error),
    name: text(row.name),
    line: text(row.line),
    markAsset: text(row.mark_asset),
    markSource: text(row.mark_source),
    markUnread: text(row.mark_unread) as IconRefusal | null,
    fontAsset: text(row.font_asset),
    fontFamily: text(row.font_family),
    fontLicence: text(row.font_licence),
    fontKind: text(row.font_kind) as FaceKind | null,
    fontSource: text(row.font_source),
    fontUnread: text(row.font_unread) as FaceUnread | null,
    colours: colours?.read && colours.used ? colours : null,
    overrides: json<Overrides>(row.overrides_json) ?? {},
    look: row.look === "site" ? "site" : "plain",
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
