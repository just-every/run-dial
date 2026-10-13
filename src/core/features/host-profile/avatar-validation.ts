import manifest from "../../../../seed.json";

export const avatarMaxBytes = manifest.limits.maxUploadBytes;
export const avatarTypes: readonly string[] = manifest.limits.allowedUploadTypes;
const ascii = (bytes: Uint8Array, from: number, until: number) => String.fromCharCode(...bytes.slice(from, until));

/** Require the declared format's signature; filenames grant no authority. */
export function matchesAvatarType(bytes: Uint8Array, type: string): boolean {
  if (type === "image/jpeg") return bytes.length >= 14 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length > 33 && ascii(bytes, bytes.length - 8, bytes.length - 4) === "IEND" && ascii(bytes, 12, 16) === "IHDR" && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  if (type === "image/webp") return bytes.length > 20 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) === bytes.length - 8 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
  if (type !== "image/avif" || bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp") return false;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (size < 16 || size >= bytes.length || size % 4 !== 0) return false;
  if (["avif", "avis"].includes(ascii(bytes, 8, 12))) return true;
  for (let offset = 16; offset + 4 <= size; offset += 4) if (["avif", "avis"].includes(ascii(bytes, offset, offset + 4))) return true;
  return false;
}

/** Read the whole body up to the limit by counting streamed bytes. Over the limit it discards the remainder and returns undefined. */
export async function readAvatarBody(request: Request): Promise<Uint8Array | undefined> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > avatarMaxBytes) { chunks.length = 0; while (!(await reader.read()).done); return undefined; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
