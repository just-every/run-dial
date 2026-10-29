-- A pending booking's API receipt is private replay authority too. Redact it
-- before erasure deletes the pending source or clears its personal claim.
CREATE TRIGGER api_approval_erasure BEFORE DELETE ON booking_approval_requests BEGIN
 UPDATE api_request_keys SET state='erased',request_hash=NULL,response_json=NULL,response_status=410,booking_id=NULL WHERE booking_id=OLD.booking_id;
END;
CREATE TRIGGER api_payment_hold_erasure BEFORE DELETE ON payment_holds BEGIN
 UPDATE api_request_keys SET state='erased',request_hash=NULL,response_json=NULL,response_status=410,booking_id=NULL WHERE booking_id=COALESCE(OLD.booking_id,json_extract(OLD.claim_json,'$.bookingId'));
END;
