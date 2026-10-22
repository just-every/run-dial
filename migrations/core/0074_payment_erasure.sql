-- Store observed Customer identity, rather than inferring creation from an invoice attempt.
ALTER TABLE payment_movements ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE payment_movements ADD COLUMN stripe_customer_observed INTEGER NOT NULL DEFAULT 0 CHECK(stripe_customer_observed IN (0,1));
-- NULL on historical receipts means sessions were not counted.
ALTER TABLE person_erasure_receipts ADD COLUMN stripe_sessions_retained INTEGER;
ALTER TABLE anonymized_audit ADD COLUMN reason TEXT;

-- A pending erasure closes paid admission before remote reconciliation and local retirement.
CREATE TRIGGER erasure_payment_hold_admission BEFORE INSERT ON payment_holds
WHEN EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=NEW.invitee_email_folded)
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;
CREATE TRIGGER erasure_payment_hold_email_change BEFORE UPDATE OF invitee_email_folded ON payment_holds
WHEN NEW.invitee_email_folded IS NOT OLD.invitee_email_folded AND
 EXISTS(SELECT 1 FROM person_erasure_locks WHERE email IN (OLD.invitee_email_folded,NEW.invitee_email_folded))
BEGIN SELECT RAISE(ABORT,'person_erasure_in_progress'); END;
