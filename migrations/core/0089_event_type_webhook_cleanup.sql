-- The relationships are retired atomically with their owning records. Older
-- schemas keep their deletion path until these webhook tables are installed.
CREATE TRIGGER webhook_event_type_delete BEFORE DELETE ON event_types BEGIN
 UPDATE routing_submissions SET event_type_id=NULL,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE event_type_id=OLD.id;
 DELETE FROM webhook_deliveries WHERE json_extract(body_json,'$.data.eventTypeId')=OLD.id;
END;

-- Vote facts identify their poll, without repeating its event-type identifier.
CREATE TRIGGER webhook_poll_delete BEFORE DELETE ON meeting_polls BEGIN
 DELETE FROM webhook_deliveries WHERE json_extract(body_json,'$.data.pollId')=OLD.id;
END;
