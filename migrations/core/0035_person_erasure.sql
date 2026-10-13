-- Establish the maintained fence identity during the additive upgrade. Preserve
-- every existing source identity/epoch; preview and failed erasure need no lazy
-- identity creation outside their transaction. Source identities are opaque.
INSERT OR IGNORE INTO rer_portability_state(id,source_identity) VALUES(1,lower(hex(randomblob(16))));

-- Shared erasure schema copied from Base 4eed99c; existing migrations remain applied.
CREATE TABLE rer_erasure_operations (
  id TEXT PRIMARY KEY NOT NULL,
  entity TEXT NOT NULL,
  subject TEXT,
  label TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('deleting','blobs','complete')),
  step INTEGER NOT NULL DEFAULT 0,
  planned TEXT NOT NULL,
  deleted TEXT NOT NULL DEFAULT '{}',
  retained TEXT NOT NULL,
  blobs_total INTEGER NOT NULL DEFAULT 0,
  blobs_deleted INTEGER NOT NULL DEFAULT 0,
  requested_at TEXT NOT NULL,
  committed_at TEXT,
  completed_at TEXT
);
CREATE UNIQUE INDEX rer_erasure_active_subject ON rer_erasure_operations(entity,subject) WHERE subject IS NOT NULL;
CREATE TABLE rer_erasure_blobs (
  operation TEXT NOT NULL, bucket TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY(operation,bucket,key)
);
CREATE TABLE rer_erasure_guard (value INTEGER NOT NULL CHECK(value=1));

-- Anonymous aggregate receipt; no email, actor or erased entity IDs.
CREATE TABLE person_erasure_receipts (
 id TEXT PRIMARY KEY NOT NULL, bookings INTEGER NOT NULL, requests INTEGER NOT NULL,
 requested_at TEXT NOT NULL, completed_at TEXT
);
ALTER TABLE erased_calendar_targets ADD COLUMN receipt_id TEXT REFERENCES person_erasure_receipts(id);
-- A provider fact is retained only while its local delivery is retained.
ALTER TABLE provider_webhook_events ADD COLUMN delivery_id TEXT;
CREATE INDEX provider_webhook_delivery ON provider_webhook_events(delivery_id);
-- Short-lived erasure admission; retained only on failure so an operator can resume.
CREATE TABLE person_erasure_locks (
 email TEXT PRIMARY KEY NOT NULL, requested_at TEXT NOT NULL,
 receipt_id TEXT REFERENCES person_erasure_receipts(id), addresses_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TRIGGER erasure_booking_admission BEFORE INSERT ON bookings
WHEN EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=(WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(NEW.invitee_email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0))
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;
CREATE TRIGGER erasure_request_admission BEFORE INSERT ON availability_requests
WHEN EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=(WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(NEW.invitee_email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0))
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;
CREATE TRIGGER erasure_delivery_admission BEFORE INSERT ON delivery_outbox
WHEN NEW.kind IN ('mail_send','reminder') AND (
 EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=(WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(json_extract(NEW.payload_json,'$.to')), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0))
 OR EXISTS(SELECT 1 FROM bookings b JOIN person_erasure_locks l ON l.email=b.invitee_email_folded WHERE b.id=NEW.booking_id)
 OR EXISTS(SELECT 1 FROM availability_requests q JOIN person_erasure_locks l ON l.email=(WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(q.invitee_email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0) WHERE q.id=NEW.request_id)
 OR (NEW.booking_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bookings WHERE id=NEW.booking_id))
 OR (NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM availability_requests WHERE id=NEW.request_id))
)
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;

-- Keep anonymous product author references without retaining a native account.
ALTER TABLE operators ADD COLUMN erased_at TEXT;
-- Snapshot creation and restore publication cannot race a confirmed person erase.
CREATE TRIGGER erasure_transfer_start BEFORE INSERT ON rer_portability_jobs
WHEN EXISTS(SELECT 1 FROM person_erasure_locks)
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;
CREATE TRIGGER erasure_transfer_apply BEFORE UPDATE OF phase ON rer_portability_jobs
WHEN NEW.phase='applying' AND EXISTS(SELECT 1 FROM person_erasure_locks)
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;

-- Unsubmitted reviews also hold a composition fingerprint. Correlate new reviews
-- for erasure; legacy unlinked reviews are conservatively retired by an erase.
ALTER TABLE availability_request_review_nonces ADD COLUMN invitee_email TEXT;
CREATE INDEX request_review_erasure_email ON availability_request_review_nonces(invitee_email);
CREATE TRIGGER erasure_review_admission BEFORE INSERT ON availability_request_review_nonces
WHEN EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=(WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(NEW.invitee_email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0))
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;

-- A delayed local capture cannot recreate erased mail after the request returns.
-- Every product message originates in a durable delivery or native auth token.
CREATE TRIGGER erasure_development_mail_source BEFORE INSERT ON rer_mail_development_outbox
WHEN NOT EXISTS(SELECT 1 FROM delivery_outbox WHERE idempotency_key=json_extract(NEW.message,'$.deliveryId') OR json_extract(payload_json,'$.providerIdempotencyKey')=json_extract(NEW.message,'$.deliveryId'))
 AND NOT EXISTS(SELECT 1 FROM oa_tokens WHERE id=json_extract(NEW.message,'$.deliveryId'))
 AND NOT EXISTS(SELECT 1 FROM oa_step_up_challenges WHERE id=json_extract(NEW.message,'$.deliveryId'))
BEGIN SELECT RAISE(ABORT,'mail_source_erased'); END;

CREATE TRIGGER erasure_booking_identity_update BEFORE UPDATE OF invitee_email ON bookings
WHEN OLD.invitee_email IS NOT NEW.invitee_email AND EXISTS(SELECT 1 FROM person_erasure_locks WHERE email IN ((WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(OLD.invitee_email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0),(WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(NEW.invitee_email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0)))
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;

CREATE TRIGGER erasure_request_identity_update BEFORE UPDATE OF invitee_email ON availability_requests
WHEN OLD.invitee_email IS NOT NEW.invitee_email AND EXISTS(SELECT 1 FROM person_erasure_locks WHERE email IN ((WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(OLD.invitee_email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0),(WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(NEW.invitee_email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0)))
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;

CREATE TRIGGER erasure_dispatch_source BEFORE INSERT ON base_mail_dispatch
WHEN NOT EXISTS(SELECT 1 FROM delivery_outbox WHERE idempotency_key=NEW.delivery_id OR json_extract(payload_json,'$.providerIdempotencyKey')=NEW.delivery_id)
 AND NOT EXISTS(SELECT 1 FROM oa_tokens WHERE id=NEW.delivery_id)
 AND NOT EXISTS(SELECT 1 FROM oa_step_up_challenges WHERE id=NEW.delivery_id)
BEGIN SELECT RAISE(ABORT,'mail_source_erased'); END;


-- A semantic erasure root lets the maintained graph remove all private children
-- while a shared domain policy keeps its original anonymous native author ID.
-- Successful erasure leaves this table empty; its deletion advances the trusted
-- archive epoch without tombstoning the retained author row.
CREATE TABLE operator_erasure_subjects (id TEXT PRIMARY KEY NOT NULL);

-- An anonymous retained author can never regain authority through a native
-- status change, direct administrative update or invitation reactivation.
CREATE TRIGGER erasure_anonymous_operator_immutable BEFORE UPDATE ON oa_operators
WHEN EXISTS(SELECT 1 FROM operators WHERE id=OLD.id AND erased_at IS NOT NULL)
 AND (NEW.status!='inactive' OR NEW.email!='erased:'||OLD.id OR NEW.display_name!='Removed operator')
BEGIN SELECT RAISE(ABORT,'operator_identity_erased'); END;

-- Native identity admission cannot race a person/operator overlap decision.
CREATE TRIGGER erasure_native_identity_admission BEFORE INSERT ON oa_operators
WHEN EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=(WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(NEW.email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0))
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;

CREATE TRIGGER erasure_native_identity_change BEFORE UPDATE OF email ON oa_operators
WHEN EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=(WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(NEW.email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0))
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;
