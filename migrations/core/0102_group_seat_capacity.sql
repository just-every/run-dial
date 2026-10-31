-- Group seats are opt-in. Existing events and bookings retain ordinary exclusion.
ALTER TABLE event_types ADD COLUMN group_capacity INTEGER
  CHECK (group_capacity IS NULL OR (typeof(group_capacity)='integer' AND group_capacity BETWEEN 2 AND 1000));

-- Configuration checks and claims share D1's write serialization. A capacity edit
-- cannot strand an admitted seat, turn ordinary bookings into seats, or remove a
-- live group's exclusion while other invitees still hold it.
CREATE TRIGGER group_capacity_active_change BEFORE UPDATE OF group_capacity ON event_types
WHEN NEW.group_capacity IS NOT OLD.group_capacity
  AND EXISTS (SELECT 1 FROM bookings b JOIN booking_occurrences o ON o.booking_id=b.id
    WHERE b.event_type_id=OLD.id AND b.state IN ('confirmed','rescheduled') AND o.is_current=1 AND o.blocks_time=1)
  AND (OLD.group_capacity IS NULL OR NEW.group_capacity IS NULL OR EXISTS (
    SELECT 1 FROM bookings b JOIN booking_occurrences o ON o.booking_id=b.id
    WHERE b.event_type_id=OLD.id AND b.state IN ('confirmed','rescheduled') AND o.is_current=1 AND o.blocks_time=1
    GROUP BY o.start_at,o.end_at HAVING count(*)>NEW.group_capacity))
BEGIN SELECT RAISE(ABORT,'group_capacity_conflict'); END;

CREATE TRIGGER group_configuration_insert BEFORE INSERT ON event_types
WHEN NEW.group_capacity IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.approval_required=1 THEN RAISE(ABORT,'group_approval_unsupported') END;
  SELECT CASE WHEN NEW.guest_limit>0 THEN RAISE(ABORT,'group_guest_unsupported') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM calendar_connections WHERE status<>'disconnected') THEN RAISE(ABORT,'group_calendar_unsupported') END;
  SELECT CASE WHEN NEW.location_type NOT IN ('fixed_link','in_person','custom','phone')
    OR (NEW.locations_json IS NOT NULL AND (json_array_length(NEW.locations_json)<>1 OR json_extract(NEW.locations_json,'$[0].type') NOT IN ('fixed_link','in_person','custom','phone')))
    OR json_array_length(NEW.duration_options_json)<>1 THEN RAISE(ABORT,'group_configuration_unsupported') END;
END;

CREATE TRIGGER group_configuration_update BEFORE UPDATE OF group_capacity,approval_required,guest_limit,duration_minutes,duration_options_json,before_buffer_minutes,after_buffer_minutes,location_type,location_value,locations_json ON event_types
WHEN NEW.group_capacity IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.approval_required=1 THEN RAISE(ABORT,'group_approval_unsupported') END;
  SELECT CASE WHEN NEW.guest_limit>0 THEN RAISE(ABORT,'group_guest_unsupported') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM calendar_connections WHERE status<>'disconnected') THEN RAISE(ABORT,'group_calendar_unsupported') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM event_type_prices WHERE event_type_id=NEW.id)
    OR EXISTS (SELECT 1 FROM event_type_payment_terms WHERE event_type_id=NEW.id AND (deposit_kind<>'none' OR late_cancel_fee_cents>0 OR no_show_fee_cents>0)) THEN RAISE(ABORT,'group_payment_unsupported') END;
  SELECT CASE WHEN NEW.location_type NOT IN ('fixed_link','in_person','custom','phone')
    OR (NEW.locations_json IS NOT NULL AND (json_array_length(NEW.locations_json)<>1 OR json_extract(NEW.locations_json,'$[0].type') NOT IN ('fixed_link','in_person','custom','phone')))
    OR json_array_length(NEW.duration_options_json)<>1 THEN RAISE(ABORT,'group_configuration_unsupported') END;
  SELECT CASE WHEN OLD.group_capacity IS NOT NULL
    AND (NEW.duration_minutes<>OLD.duration_minutes OR NEW.duration_options_json<>OLD.duration_options_json
      OR NEW.before_buffer_minutes<>OLD.before_buffer_minutes OR NEW.after_buffer_minutes<>OLD.after_buffer_minutes
      OR NEW.location_type<>OLD.location_type OR NEW.location_value<>OLD.location_value OR NEW.locations_json IS NOT OLD.locations_json)
    AND EXISTS (SELECT 1 FROM bookings b JOIN booking_occurrences o ON o.booking_id=b.id WHERE b.event_type_id=OLD.id AND b.state IN ('confirmed','rescheduled') AND o.is_current=1 AND o.blocks_time=1)
    THEN RAISE(ABORT,'group_capacity_conflict') END;
END;

CREATE TRIGGER group_price_insert BEFORE INSERT ON event_type_prices
WHEN EXISTS (SELECT 1 FROM event_types WHERE id=NEW.event_type_id AND group_capacity IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'group_payment_unsupported'); END;
CREATE TRIGGER group_price_update BEFORE UPDATE ON event_type_prices
WHEN EXISTS (SELECT 1 FROM event_types WHERE id=NEW.event_type_id AND group_capacity IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'group_payment_unsupported'); END;
CREATE TRIGGER group_payment_terms_insert BEFORE INSERT ON event_type_payment_terms
WHEN (NEW.deposit_kind<>'none' OR NEW.late_cancel_fee_cents>0 OR NEW.no_show_fee_cents>0)
  AND EXISTS (SELECT 1 FROM event_types WHERE id=NEW.event_type_id AND group_capacity IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'group_payment_unsupported'); END;
CREATE TRIGGER group_payment_terms_update BEFORE UPDATE ON event_type_payment_terms
WHEN (NEW.deposit_kind<>'none' OR NEW.late_cancel_fee_cents>0 OR NEW.no_show_fee_cents>0)
  AND EXISTS (SELECT 1 FROM event_types WHERE id=NEW.event_type_id AND group_capacity IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'group_payment_unsupported'); END;

CREATE INDEX group_slot_seats_idx ON booking_occurrences(start_at,end_at,booking_id)
  WHERE is_current=1 AND blocks_time=1;
