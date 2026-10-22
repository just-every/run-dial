-- PAY-007: frozen authorization references and durable capture/void decisions extend the existing request.
-- The live claim and payment hold remain mandatory authority; archived payment history cannot execute commands.
ALTER TABLE booking_approval_requests ADD COLUMN payment_json TEXT CHECK(payment_json IS NULL OR json_valid(payment_json));
