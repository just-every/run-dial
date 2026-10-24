import { brotliDecompressSync, inflateSync } from "node:zlib";

/** What a font file says about itself in its `name` table. */
export interface FontNames {
  /** Typographic family (name 16), else family (name 1). */
  family: string | null;
  /** License Description (name 13). */
  licence: string | null;
  /** License Info URL (name 14). */
  licenceUrl: string | null;
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

export const fontContentType: Record<FontFormat, string> = { woff2: "font/woff2", woff: "font/woff", truetype: "font/ttf", opentype: "font/otf" };

/** The file's names, or null when it is not a single font this reader understands (a collection, or malformed). */
export function fontNames(bytes: Uint8Array): FontNames | null {
  try {
    const table = nameTable(bytes);
    return table ? readNames(table) : null;
  } catch {
    return null;
  }
}

function nameTable(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = fontFormat(bytes);
  if (format === "truetype" || format === "opentype") {
    const count = view.getUint16(4);
    for (let index = 0; index < count; index++) {
      const record = 12 + index * 16;
      if (ascii(bytes, record, record + 4) === "name") return bytes.subarray(view.getUint32(record + 8), view.getUint32(record + 8) + view.getUint32(record + 12));
    }
    return null;
  }
  if (format === "woff") {
    const count = view.getUint16(12);
    for (let index = 0; index < count; index++) {
      const entry = 44 + index * 20;
      if (ascii(bytes, entry, entry + 4) !== "name") continue;
      const offset = view.getUint32(entry + 4), compressed = view.getUint32(entry + 8), original = view.getUint32(entry + 12);
      const data = bytes.subarray(offset, offset + compressed);
      return compressed < original ? new Uint8Array(inflateSync(data)) : data;
    }
    return null;
  }
  if (format === "woff2") return woff2NameTable(bytes, view);
  return null;
}

// WOFF2 known table tags, by the index its directory flags carry.
const WOFF2_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

/** WOFF2 keeps every table in one Brotli stream after its directory; `name` is never transformed. */
function woff2NameTable(bytes: Uint8Array, view: DataView): Uint8Array | null {
  if (ascii(bytes, 4, 8) === "ttcf") return null;
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
  let at = 0, name: { at: number; length: number } | null = null;
  for (let index = 0; index < count; index++) {
    const flags = bytes[offset++];
    let tag = WOFF2_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) { tag = ascii(bytes, offset, offset + 4); offset += 4; }
    const version = flags >> 6;
    const original = base128();
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    const length = transformed ? base128() : original;
    if (tag === "name") name = { at, length: original };
    at += length;
  }
  if (!name) return null;
  const tables = new Uint8Array(brotliDecompressSync(bytes.subarray(offset, offset + compressedLength)));
  return tables.subarray(name.at, name.at + name.length);
}

/** Windows English names first, then any Unicode or Windows entry, then Mac Roman. */
function readNames(table: Uint8Array): FontNames {
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
