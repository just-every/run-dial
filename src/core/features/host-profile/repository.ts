import { ulid } from "ulid";
import { publicLookFrom, publicLookStatement, type PublicLook } from "../site-look";
import { upsertProfile } from "./profile-writes";

export type FocusAreaInput = { label: string };
export type SocialProofInput = { quote: string; attribution: string };
export type ProfileInput = {
  handle: string;
  name: string;
  title: string;
  biography: string;
  timezone: string;
  focusAreas: FocusAreaInput[];
  socialProof: SocialProofInput[];
};

/** `look` is the booking pages' look (BRAND-001), read in the same batch so pages need no extra request. */
export type ProfileRecord = ProfileInput & { id: string; createdAt: string; updatedAt: string; avatarKey?: string | null; avatarContentType?: string | null; look?: PublicLook };

export class HostProfileRepository {
  private readonly binding: D1Database;

  constructor(binding: D1Database) {
    this.binding = binding;
  }

  async get(): Promise<ProfileRecord | undefined> {
    const [parent, areas, proof, look] = await this.binding.batch([
      this.binding.prepare("SELECT id, handle, name, title, biography, timezone, created_at AS createdAt, updated_at AS updatedAt, avatar_key AS avatarKey, avatar_content_type AS avatarContentType FROM host_profiles WHERE singleton_key = 'default'"),
      this.binding.prepare("SELECT label FROM profile_focus_areas WHERE profile_id = (SELECT id FROM host_profiles WHERE singleton_key = 'default') ORDER BY position"),
      this.binding.prepare("SELECT quote, attribution FROM social_proof_entries WHERE profile_id = (SELECT id FROM host_profiles WHERE singleton_key = 'default') ORDER BY position"),
      publicLookStatement(this.binding),
    ]);
    const profile = parent.results[0] as Omit<ProfileRecord, "focusAreas" | "socialProof" | "look"> | undefined;
    if (!profile) return undefined;
    return {
      ...profile,
      focusAreas: areas.results as FocusAreaInput[],
      socialProof: proof.results as SocialProofInput[],
      look: publicLookFrom(look),
    };
  }

  async setAvatar(previousKey: string | null, key: string | null, contentType: string | null, uploadId: string | null = null) {
    const now = new Date().toISOString();
    const [result] = await this.binding.batch([
      this.binding.prepare("UPDATE host_profiles SET avatar_key = ?, avatar_content_type = ?, updated_at = ? WHERE singleton_key = 'default' AND avatar_key IS ? AND (? IS NULL OR EXISTS (SELECT 1 FROM avatar_object_deletions WHERE object_key = ? AND id = ?))").bind(key, contentType, now, previousKey, key, key, uploadId),
      this.binding.prepare("INSERT OR IGNORE INTO avatar_object_deletions(id,object_key,created_at,updated_at) SELECT ?,?,?,? WHERE changes() = 1 AND ? IS NOT NULL").bind(ulid(), previousKey, now, now, previousKey),
      this.binding.prepare("DELETE FROM avatar_object_deletions WHERE object_key = ? AND id = ? AND object_key = (SELECT avatar_key FROM host_profiles WHERE singleton_key = 'default')").bind(key, uploadId),
    ]);
    return result.meta.changes === 1;
  }

  async enqueueAvatarDeletion(key: string) {
    const now = new Date().toISOString();
    const id = ulid();
    await this.binding.prepare("INSERT INTO avatar_object_deletions(id,object_key,created_at,updated_at) VALUES (?,?,?,?)").bind(id, key, now, now).run();
    return id;
  }

  async pendingAvatarDeletions() {
    return (await this.binding.prepare("SELECT id, object_key FROM avatar_object_deletions WHERE object_key IS NOT (SELECT avatar_key FROM host_profiles WHERE singleton_key='default') ORDER BY created_at").all<{ id: string; object_key: string }>()).results;
  }

  async claimAvatarDeletion(key: string, observedId: string | null = null) {
    // Each cleanup attempt replaces the upload/previous cleanup token. An upload
    // that loses its token can no longer publish this object as the current avatar.
    const id = ulid();
    const result = await this.binding.prepare("UPDATE avatar_object_deletions SET id = ?, updated_at = ? WHERE object_key = ? AND (? IS NULL OR id = ?) AND object_key IS NOT (SELECT avatar_key FROM host_profiles WHERE singleton_key = 'default')")
      .bind(id, new Date().toISOString(), key, observedId, observedId).run();
    return result.meta.changes === 1 ? id : undefined;
  }

  async finishAvatarDeletion(key: string, id: string) {
    await this.binding.prepare("DELETE FROM avatar_object_deletions WHERE object_key = ? AND id = ?").bind(key, id).run();
  }

  async getByHandle(handle: string) {
    const profile = await this.get();
    return profile?.handle === handle ? profile : undefined;
  }

  async upsert(input: ProfileInput): Promise<ProfileRecord> {
    await upsertProfile(this.binding, input);
    const result = await this.get();
    if (!result) throw new Error("Host profile was not persisted");
    return result;
  }
}
