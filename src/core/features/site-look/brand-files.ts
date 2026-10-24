import { RuntimeConfigurationError } from "../../shared/runtime-env";
import { brandExtensions } from "./public-look";

/** An unreferenced brand file younger than this may belong to a read that is still storing its look. */
const sweepAfterMs = 10 * 60_000;

/** The read mark and face in R2 under brand/<sha256>.<ext>: the same bytes always land at the same key. */
export class BrandFiles {
  constructor(private readonly files?: R2Bucket) {}

  private bucket() {
    if (!this.files) throw new RuntimeConfigurationError(["FILES"]);
    return this.files;
  }

  async put(bytes: Uint8Array, contentType: string) {
    const extension = brandExtensions[contentType];
    if (!extension) throw new Error(`No brand file type for ${contentType}`);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
    const key = `brand/${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}.${extension}`;
    await this.bucket().put(key, bytes, { httpMetadata: { contentType } });
    return key;
  }

  get(key: string) {
    return this.bucket().get(key);
  }

  /** Deletes brand files no stored look references; recent ones are left for the read that may still own them. */
  async sweep(keep: (string | null)[], now = Date.now()) {
    const bucket = this.bucket();
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: "brand/", cursor });
      const unused = page.objects.filter((object) => !keep.includes(object.key) && now - object.uploaded.getTime() > sweepAfterMs).map((object) => object.key);
      if (unused.length) await bucket.delete(unused);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }

  /** A read that lost to another write takes back the files only it put there. */
  async discard(keys: (string | null)[], keep: (string | null)[]) {
    const own = keys.filter((key): key is string => key !== null && !keep.includes(key));
    if (own.length) await this.bucket().delete(own);
  }
}
