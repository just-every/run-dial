-- Invitee-record erasure retains associated operator access. Persist only an
-- anonymous status on the aggregate receipt; existing receipts and rows survive.
ALTER TABLE person_erasure_receipts ADD COLUMN operator_identity_retained INTEGER NOT NULL DEFAULT 0 CHECK(operator_identity_retained IN (0,1));

-- Rewriting an unchanged native email must not obstruct a retained identity.
-- Actual address changes into an admitted email remain closed. Once the person
-- receipt is established, changing its retained identity away is also closed.
-- Standalone operator erasure has no person receipt and may anonymize its author.
DROP TRIGGER erasure_native_identity_change;
CREATE TRIGGER erasure_native_identity_change BEFORE UPDATE OF email ON oa_operators
WHEN OLD.email IS NOT NEW.email AND (
 EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=(WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(NEW.email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0))
 OR EXISTS(SELECT 1 FROM person_erasure_locks WHERE receipt_id IS NOT NULL AND email=(WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(OLD.email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0))
)
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;

-- The native account owns this product projection. Guard new/changed projection
-- identities too, while allowing ordinary status updates and unchanged emails.
CREATE TRIGGER erasure_product_identity_admission BEFORE INSERT ON operators
WHEN EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=(WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(NEW.normalized_email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0))
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;
CREATE TRIGGER erasure_product_identity_change BEFORE UPDATE OF normalized_email ON operators
WHEN OLD.normalized_email IS NOT NEW.normalized_email AND (
 EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=(WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(NEW.normalized_email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0))
 OR EXISTS(SELECT 1 FROM person_erasure_locks WHERE receipt_id IS NOT NULL AND email=(WITH RECURSIVE fold(remaining,result) AS (
 SELECT trim(OLD.normalized_email), '' UNION ALL
 SELECT CAST(substr(CAST(remaining AS BLOB),max(1,length(CAST(substr(remaining,1,1) AS BLOB)))+1) AS TEXT),
 result || coalesce((SELECT folded FROM booking_search_casefold WHERE codepoint=unicode(remaining)),CASE WHEN unicode(remaining) IS NULL THEN char(0) ELSE substr(remaining,1,1) END)
 FROM fold WHERE length(CAST(remaining AS BLOB))>0
) SELECT result FROM fold WHERE length(CAST(remaining AS BLOB))=0))
)
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;
