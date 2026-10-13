import { createId, nowIso } from "../../shared/ids";
import type { ProfileRecord } from "../host-profile";
import type { EventTypeRecord } from "../event-types";

export type LinkCopyReport = { eventTypeId: string; canonicalUrl: string; acceptedAt: string };

export class HostSetupRepository {
  constructor(private readonly binding: D1Database) {}

  async completion() {
    const identity = await this.binding.prepare("SELECT onboarding_completed_at AS completedAt FROM operator_setup_identity WHERE singleton_key='default'").first<{ completedAt: string | null }>();
    return identity?.completedAt ?? null;
  }

  async complete(event: EventTypeRecord, profile: ProfileRecord, canonicalUrl: string) {
    // Completion and the current copy/report snapshot are checked in one write.
    const result = await this.binding.prepare(`UPDATE operator_setup_identity SET onboarding_completed_at=?
      WHERE singleton_key='default' AND onboarding_completed_at IS NULL AND EXISTS (
        SELECT 1 FROM event_types e JOIN host_profiles p ON p.singleton_key='default'
        JOIN host_link_copy_reports r ON r.event_type_id=e.id AND r.canonical_url=?
        WHERE e.id=? AND e.status='published' AND e.slug=? AND e.updated_at=?
        AND e.request_only=? AND e.alternative_requests_enabled=?
        AND p.id=? AND p.handle=? AND p.name=? AND p.timezone=? AND p.updated_at=?)
      RETURNING onboarding_completed_at AS completedAt`)
      .bind(nowIso(), canonicalUrl, event.id, event.slug, event.updatedAt, Number(Boolean(event.requestOnly)),
        Number(event.alternativeRequestsEnabled), profile.id, profile.handle, profile.name, profile.timezone, profile.updatedAt)
      .first<{ completedAt: string }>();
    return result?.completedAt ?? await this.completion();
  }

  /** True once saved scheduling data has been imported, so Overview can link the switch-over checklist. */
  async moveInStarted() {
    return Boolean(await this.binding.prepare("SELECT 1 FROM move_in_targets UNION ALL SELECT 1 FROM move_in_captures LIMIT 1").first());
  }

  async reports() {
    const result = await this.binding.prepare("SELECT event_type_id AS eventTypeId, canonical_url AS canonicalUrl, accepted_at AS acceptedAt FROM host_link_copy_reports").all<LinkCopyReport>();
    return result.results;
  }

  async record(event: EventTypeRecord, profile: ProfileRecord, canonicalUrl: string) {
    const timestamp = nowIso();
    // Snapshot guards close the await-to-write race. Triggers invalidate later writes.
    const result = await this.binding.prepare(`INSERT INTO host_link_copy_reports
      (id,event_type_id,canonical_url,accepted_at,created_at,updated_at)
      SELECT ?,e.id,?,?,?,? FROM event_types e JOIN host_profiles p ON p.singleton_key='default'
      WHERE e.id=? AND e.status='published' AND e.slug=? AND e.updated_at=?
      AND e.request_only=? AND e.alternative_requests_enabled=?
      AND p.id=? AND p.handle=? AND p.name=? AND p.timezone=? AND p.updated_at=?
      ON CONFLICT(event_type_id) DO UPDATE SET canonical_url=excluded.canonical_url,
        accepted_at=excluded.accepted_at,updated_at=excluded.updated_at
      RETURNING event_type_id AS eventTypeId,canonical_url AS canonicalUrl,accepted_at AS acceptedAt`)
      .bind(createId(), canonicalUrl, timestamp, timestamp, timestamp, event.id, event.slug, event.updatedAt,
        Number(Boolean(event.requestOnly)), Number(event.alternativeRequestsEnabled), profile.id, profile.handle, profile.name, profile.timezone, profile.updatedAt)
      .first<LinkCopyReport>();
    return result;
  }
}
