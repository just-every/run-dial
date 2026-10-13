import { createId, nowIso } from "../../shared/ids";
import type { ProfileInput } from "./repository";

/** One atomic singleton save, including its ordered public content. */
export async function upsertProfile(binding: D1Database, input: ProfileInput) {
  const timestamp = nowIso();
  await binding.batch([
    binding.prepare("INSERT INTO host_profiles (id, singleton_key, handle, name, title, biography, timezone, created_at, updated_at) VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(singleton_key) DO UPDATE SET handle = excluded.handle, name = excluded.name, title = excluded.title, biography = excluded.biography, timezone = excluded.timezone, updated_at = excluded.updated_at")
      .bind(createId(), input.handle, input.name, input.title, input.biography, input.timezone, timestamp, timestamp),
    binding.prepare("DELETE FROM profile_focus_areas WHERE profile_id = (SELECT id FROM host_profiles WHERE singleton_key = 'default')"),
    binding.prepare("DELETE FROM social_proof_entries WHERE profile_id = (SELECT id FROM host_profiles WHERE singleton_key = 'default')"),
    ...input.focusAreas.map((area, position) => binding.prepare("INSERT INTO profile_focus_areas (id, profile_id, label, position, created_at, updated_at) SELECT ?, id, ?, ?, ?, ? FROM host_profiles WHERE singleton_key = 'default'")
      .bind(createId(), area.label, position, timestamp, timestamp)),
    ...input.socialProof.map((entry, position) => binding.prepare("INSERT INTO social_proof_entries (id, profile_id, quote, attribution, position, created_at, updated_at) SELECT ?, id, ?, ?, ?, ?, ? FROM host_profiles WHERE singleton_key = 'default'")
      .bind(createId(), entry.quote, entry.attribution, position, timestamp, timestamp)),
  ]);
}
