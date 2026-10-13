import { RuntimeConfigurationError } from "../../shared/runtime-env";
import type { HostProfileRepository } from "./repository";

/** R2 authority is supplied by app composition, never by the upload name. */
export class AvatarStorage {
  constructor(readonly repository: HostProfileRepository, private readonly files?: R2Bucket) {}
  private bucket() {
    if (!this.files) throw new RuntimeConfigurationError(["FILES"]);
    return this.files;
  }
  async put(key: string, bytes: Uint8Array, type: string) {
    const bucket = this.bucket();
    const uploadId = await this.repository.enqueueAvatarDeletion(key);
    try { await bucket.put(key, bytes, { httpMetadata: { contentType: type } }); }
    catch (error) { await this.delete(key); throw error; }
    return uploadId;
  }
  get(key: string) { return this.bucket().get(key); }
  async delete(key: string, observedId: string | null = null) {
    const id = await this.repository.claimAvatarDeletion(key, observedId);
    if (!id) return;
    await this.bucket().delete(key);
    await this.repository.finishAvatarDeletion(key, id);
  }
  async cleanup() {
    for (const row of await this.repository.pendingAvatarDeletions()) {
      // An empty intent may belong to a PUT that has not reached R2 yet. Keep its
      // authority until bytes exist or the writer explicitly settles a failure.
      // A terminated writer leaves only a random key and timestamps indefinitely;
      // the existing archive includes this row without requiring an R2 object.
      // No expiry can prove that a delayed PUT will never arrive.
      // HEAD precedes the conditional claim: publication wins, or loses its token.
      if (await this.bucket().head(row.object_key)) await this.delete(row.object_key, row.id);
    }
  }
}
