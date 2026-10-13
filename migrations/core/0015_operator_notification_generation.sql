-- Each removal retires the recipient admission selected by in-flight producers.
-- Existing unversioned commands belong to generation zero, never a later invite.
ALTER TABLE operators ADD COLUMN access_generation INTEGER NOT NULL DEFAULT 0;
-- A removal performed before this upgrade has already retired legacy authority.
UPDATE operators SET access_generation = 1 WHERE removed_at IS NOT NULL;
CREATE TRIGGER operator_notification_generation AFTER UPDATE OF removed_at ON operators
WHEN NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL
BEGIN
  UPDATE operators SET access_generation = OLD.access_generation + 1 WHERE id = NEW.id;
END;

-- A producer may finish after both removal and re-invitation. Persist the failed
-- command visibly without granting authority from the newer admission. This uses
-- the same role/key/frozen-recipient rule as delivery/operator-mail.ts.
CREATE TRIGGER operator_notification_admission AFTER INSERT ON delivery_outbox
WHEN NEW.kind IN ('mail_send', 'reminder')
  AND (json_extract(NEW.payload_json, '$.recipientRole') = 'operator' OR
    (json_extract(NEW.payload_json, '$.recipientRole') IS NULL AND
      ((substr(COALESCE(json_extract(NEW.payload_json, '$.providerIdempotencyKey'), NEW.idempotency_key), 1, 11) = 'connection:'
          AND instr(COALESCE(json_extract(NEW.payload_json, '$.providerIdempotencyKey'), NEW.idempotency_key), ':operator:') > 11)
        OR (substr(COALESCE(json_extract(NEW.payload_json, '$.providerIdempotencyKey'), NEW.idempotency_key), 1, length('request:' || NEW.request_id || ':operator:')) = 'request:' || NEW.request_id || ':operator:'
          AND substr(COALESCE(json_extract(NEW.payload_json, '$.providerIdempotencyKey'), NEW.idempotency_key), -10) = ':submitted'))))
  AND NOT EXISTS (SELECT 1 FROM operators o WHERE o.removed_at IS NULL
    AND o.normalized_email = lower(trim(COALESCE(json_extract(NEW.payload_json, '$.wireMail.to'), json_extract(NEW.payload_json, '$.to'))))
    AND ((json_type(NEW.payload_json, '$.operatorAccess') IS NULL AND o.access_generation = 0)
      OR (o.id = json_extract(NEW.payload_json, '$.operatorAccess.id')
        AND o.access_generation = json_extract(NEW.payload_json, '$.operatorAccess.generation'))))
BEGIN
  UPDATE delivery_outbox
    SET payload_json = json_set(payload_json, '$.operatorAccessRevoked', json('true')),
      state = CASE WHEN state IN ('pending', 'processing') THEN 'failed' ELSE state END,
      last_error_code = CASE WHEN state IN ('pending', 'processing') THEN 'operator_removed' ELSE last_error_code END
    WHERE id = NEW.id;
END;
