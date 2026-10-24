import { brotliDecompressSync, inflateSync } from "node:zlib";

/** What kind of face a family is, as near as a page needs: sans, serif, monospace, display or script. */
export type FaceKind = "sans" | "serif" | "mono" | "display" | "script";

/** What a font file says about itself: its `name` table, and its kind from its own classification. */
export interface FontFacts {
  /** Typographic family (name 16), else family (name 1). */
  family: string | null;
  /** License Description (name 13). */
  licence: string | null;
  /** License Info URL (name 14). */
  licenceUrl: string | null;
  /** `post` fixed pitch, then OS/2's PANOSE, then its IBM family class; null when the file does not say. */
  kind: FaceKind | null;
}

export type FontFormat = "woff2" | "woff" | "truetype" | "opentype";

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

/** The format by signature, never by the name or the declared type. */
export function fontFormat(bytes: Uint8Array): FontFormat | null {
  if (bytes.length < 12) return null;
  const tag = ascii(bytes, 0, 4);
  if (tag === "wOF2") return "woff2";
  if (tag === "wOFF") return "woff";
  if (tag === "OTTO") return "opentype";
  if (tag === "true" || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return "truetype";
  return null;
}

/** The file's facts, or null when it is not a single font this reader understands (a collection, or malformed). */
export function fontFacts(bytes: Uint8Array): FontFacts | null {
  try {
    const tables = fontTables(bytes);
    const name = tables.get("name");
    return name ? { ...readNames(name), kind: fontKind(tables.get("OS/2"), tables.get("post")) } : null;
  } catch {
    return null;
  }
}

const wanted = new Set(["name", "OS/2", "post"]);

function fontTables(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = fontFormat(bytes);
  const tables = new Map<string, Uint8Array>();
  if (format === "truetype" || format === "opentype") {
    const count = view.getUint16(4);
    for (let index = 0; index < count; index++) {
      const record = 12 + index * 16, tag = ascii(bytes, record, record + 4);
      if (wanted.has(tag)) tables.set(tag, bytes.subarray(view.getUint32(record + 8), view.getUint32(record + 8) + view.getUint32(record + 12)));
    }
  } else if (format === "woff") {
    const count = view.getUint16(12);
    for (let index = 0; index < count; index++) {
      const entry = 44 + index * 20, tag = ascii(bytes, entry, entry + 4);
      if (!wanted.has(tag)) continue;
      const offset = view.getUint32(entry + 4), compressed = view.getUint32(entry + 8), original = view.getUint32(entry + 12);
      const data = bytes.subarray(offset, offset + compressed);
      tables.set(tag, compressed < original ? new Uint8Array(inflateSync(data)) : data);
    }
  } else if (format === "woff2") woff2Tables(bytes, view, tables);
  return tables;
}

// WOFF2 known table tags, by the index its directory flags carry.
const WOFF2_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

/** WOFF2 keeps every table in one Brotli stream after its directory; `name`, `OS/2` and `post` are never transformed. */
function woff2Tables(bytes: Uint8Array, view: DataView, tables: Map<string, Uint8Array>) {
  if (ascii(bytes, 4, 8) === "ttcf") return;
  const count = view.getUint16(12);
  const compressedLength = view.getUint32(20);
  let offset = 48;
  const base128 = () => {
    let value = 0;
    for (let index = 0; index < 5; index++) {
      const byte = bytes[offset++];
      if (index === 0 && byte === 0x80) throw new Error("Leading zero in UIntBase128");
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error("UIntBase128 longer than five bytes");
  };
  let at = 0;
  const found: { tag: string; at: number; length: number }[] = [];
  for (let index = 0; index < count; index++) {
    const flags = bytes[offset++];
    let tag = WOFF2_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) { tag = ascii(bytes, offset, offset + 4); offset += 4; }
    const version = flags >> 6;
    const original = base128();
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    const length = transformed ? base128() : original;
    if (wanted.has(tag) && !transformed) found.push({ tag, at, length: original });
    at += length;
  }
  if (!found.some((table) => table.tag === "name")) return;
  const stream = new Uint8Array(brotliDecompressSync(bytes.subarray(offset, offset + compressedLength)));
  for (const table of found) tables.set(table.tag, stream.subarray(table.at, table.at + table.length));
}

/** The kind the file gives itself: a fixed pitch is monospace; then PANOSE (Latin text: proportion, then serif style;
 * hand-written; decorative); then the IBM family class in OS/2. */
function fontKind(os2: Uint8Array | undefined, post: Uint8Array | undefined): FaceKind | null {
  if (post && post.length >= 16 && new DataView(post.buffer, post.byteOffset, post.byteLength).getUint32(12) !== 0) return "mono";
  if (!os2 || os2.length < 42) return null;
  const [family, serif, , proportion] = os2.subarray(32, 36);
  if (family === 2) {
    if (proportion === 9) return "mono";
    if (serif >= 11 && serif <= 15) return "sans";
    if (serif >= 2 && serif <= 10) return "serif";
  }
  if (family === 3) return "script";
  if (family === 4) return "display";
  const ibmClass = os2[30];
  if ([1, 2, 3, 4, 5, 7].includes(ibmClass)) return "serif";
  if (ibmClass === 8) return "sans";
  if (ibmClass === 9) return "display";
  if (ibmClass === 10) return "script";
  return null;
}

/** Windows English names first, then any Unicode or Windows entry, then Mac Roman. */
function readNames(table: Uint8Array): Omit<FontFacts, "kind"> {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const count = view.getUint16(2), strings = view.getUint16(4);
  const found = new Map<number, { rank: number; text: string }>();
  for (let index = 0; index < count; index++) {
    const record = 6 + index * 12;
    const platform = view.getUint16(record), encoding = view.getUint16(record + 2), language = view.getUint16(record + 4);
    const id = view.getUint16(record + 6), length = view.getUint16(record + 8), offset = view.getUint16(record + 10);
    if (![1, 13, 14, 16].includes(id)) continue;
    const raw = table.subarray(strings + offset, strings + offset + length);
    const rank = platform === 3 && language === 0x409 ? 0 : platform === 3 || platform === 0 ? 1 : platform === 1 && encoding === 0 ? 2 : 9;
    if (rank === 9) continue;
    const text = (rank === 2 ? String.fromCharCode(...raw) : utf16be(raw)).replace(/\s+/g, " ").trim();
    if (text && (!found.has(id) || found.get(id)!.rank > rank)) found.set(id, { rank, text });
  }
  return { family: found.get(16)?.text ?? found.get(1)?.text ?? null, licence: found.get(13)?.text ?? null, licenceUrl: found.get(14)?.text ?? null };
}

function utf16be(bytes: Uint8Array) {
  let text = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
  return text;
}
