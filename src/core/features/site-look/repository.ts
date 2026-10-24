import { createId, nowIso } from "../../shared/ids";
import { selectStoredLook, storedLook, type Overrides, type ReadError, type StoredColours, type StoredLook } from "./stored";

/** What a successful read stores. */
export interface ReadLook {
  websiteUrl: string;
  readAt: string;
  name: string | null;
  line: string | null;
  markAsset: string | null;
  fontAsset: string | null;
  fontFamily: string | null;
  fontLicence: string | null;
  colours: StoredColours;
  overrides: Overrides;
}

/** One row per workspace. Every write names the revision it read and lands only if the row is still at it. */
export class SiteLookRepository {
  constructor(private readonly binding: D1Database) {}

  async get(): Promise<StoredLook | null> {
    return storedLook(await this.binding.prepare(selectStoredLook).first<Record<string, unknown>>());
  }

  /** A successful read becomes the look shown. */
  async saveRead(previous: StoredLook | null, read: ReadLook) {
    const now = nowIso();
    const values = [read.websiteUrl, read.readAt, read.name, read.line, read.markAsset, read.fontAsset, read.fontFamily, read.fontLicence, JSON.stringify(read.colours), JSON.stringify(read.overrides)];
    if (!previous) {
      return this.changed(this.binding.prepare("INSERT INTO site_looks (id, website_url, read_at, read_error, name, line, mark_asset, font_asset, font_family, font_licence, colours_json, overrides_json, look, revision, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'site', 1, ?, ?) ON CONFLICT(singleton_key) DO NOTHING")
        .bind(createId(), ...values, now, now));
    }
    return this.changed(this.binding.prepare("UPDATE site_looks SET website_url = ?, read_at = ?, read_error = NULL, name = ?, line = ?, mark_asset = ?, font_asset = ?, font_family = ?, font_licence = ?, colours_json = ?, overrides_json = ?, look = 'site', revision = revision + 1, updated_at = ? WHERE singleton_key = 'default' AND revision = ?")
      .bind(...values, now, previous.revision));
  }

  /** A failed read is recorded and changes nothing else: the previous look, if any, stays. */
  async saveFailure(previous: StoredLook | null, error: ReadError) {
    const now = nowIso();
    if (!previous) {
      return this.changed(this.binding.prepare("INSERT INTO site_looks (id, read_error, look, revision, created_at, updated_at) VALUES (?, ?, 'plain', 1, ?, ?) ON CONFLICT(singleton_key) DO NOTHING")
        .bind(createId(), JSON.stringify(error), now, now));
    }
    return this.changed(this.binding.prepare("UPDATE site_looks SET read_error = ?, revision = revision + 1, updated_at = ? WHERE singleton_key = 'default' AND revision = ?")
      .bind(JSON.stringify(error), now, previous.revision));
  }

  /** The owner's changes: which look shows, and values changed one by one. */
  async saveChanges(previous: StoredLook, change: { look: "site" | "plain"; overrides: Overrides; colours: StoredColours | null }) {
    return this.changed(this.binding.prepare("UPDATE site_looks SET look = ?, overrides_json = ?, colours_json = ?, revision = revision + 1, updated_at = ? WHERE singleton_key = 'default' AND revision = ?")
      .bind(change.look, JSON.stringify(change.overrides), JSON.stringify(change.colours ?? {}), nowIso(), previous.revision));
  }

  /** Back to plain: the read, the owner's changes and the record of failures are forgotten. */
  async remove(previous: StoredLook) {
    return this.changed(this.binding.prepare("DELETE FROM site_looks WHERE singleton_key = 'default' AND revision = ?").bind(previous.revision));
  }

  private async changed(statement: D1PreparedStatement) {
    return (await statement.run()).meta.changes === 1;
  }
}
