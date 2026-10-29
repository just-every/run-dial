-- Resolve native API host ownership when each fact is captured.

DROP TRIGGER webhook_booking_history;
CREATE TRIGGER webhook_booking_history AFTER INSERT ON booking_history WHEN NEW.action IN ('created','rescheduled','cancelled','calendar_cancelled','attendance_marked') BEGIN
INSERT OR IGNORE INTO webhook_deliveries(id,subscription_id,event_id,event_type,booking_id,body_json,next_attempt_at,retry_until,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),s.id,NEW.id,CASE NEW.action WHEN 'created' THEN 'booking.created.v1' WHEN 'rescheduled' THEN 'booking.rescheduled.v1' WHEN 'attendance_marked' THEN CASE WHEN (SELECT status FROM booking_attendance WHERE booking_id=NEW.booking_id)='no_show' THEN 'booking.no-show.v1' ELSE 'booking.attendance.v1' END ELSE 'booking.canceled.v1' END,b.id,
 json_object('id',NEW.id,'type',CASE NEW.action WHEN 'created' THEN 'booking.created.v1' WHEN 'rescheduled' THEN 'booking.rescheduled.v1' WHEN 'attendance_marked' THEN CASE WHEN (SELECT status FROM booking_attendance WHERE booking_id=NEW.booking_id)='no_show' THEN 'booking.no-show.v1' ELSE 'booking.attendance.v1' END ELSE 'booking.canceled.v1' END,'occurredAt',NEW.created_at,'data',json(json_object('bookingId',b.id,'eventTypeId',b.event_type_id,'state',b.state,'sequence',o.sequence,'startAt',o.start_at,'endAt',o.end_at,'durationMinutes',b.duration_minutes,'attribution',json(b.attribution_json)))),
 NEW.created_at,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+24 hours'),NEW.created_at,NEW.created_at
 FROM webhook_subscriptions s JOIN bookings b ON b.id=NEW.booking_id JOIN booking_occurrences o ON o.id=b.current_occurrence_id
 WHERE s.enabled=1 AND s.secret_ciphertext IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(s.events_json) WHERE value=CASE NEW.action WHEN 'created' THEN 'booking.created.v1' WHEN 'rescheduled' THEN 'booking.rescheduled.v1' WHEN 'attendance_marked' THEN CASE WHEN (SELECT status FROM booking_attendance WHERE booking_id=NEW.booking_id)='no_show' THEN 'booking.no-show.v1' ELSE 'booking.attendance.v1' END ELSE 'booking.canceled.v1' END)
 AND (s.scope='workspace' OR (s.scope='host' AND s.scope_id=COALESCE((SELECT host_id FROM api_event_hosts WHERE event_type_id=b.event_type_id),(SELECT id FROM host_profiles WHERE singleton_key='default'))) OR (s.scope='team' AND (s.scope_id=NULL OR EXISTS(SELECT 1 FROM team_event_types te WHERE te.team_id=s.scope_id AND te.event_type_id=b.event_type_id))))
 AND (NOT EXISTS(SELECT 1 FROM person_erasure_locks l WHERE l.email=b.invitee_email_folded));
END;

DROP TRIGGER webhook_reschedule_requested;
CREATE TRIGGER webhook_reschedule_requested AFTER INSERT ON booking_request_history WHEN NEW.action='reschedule_requested' BEGIN
INSERT OR IGNORE INTO webhook_deliveries(id,subscription_id,event_id,event_type,booking_id,body_json,next_attempt_at,retry_until,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),s.id,NEW.id,'booking.reschedule-requested.v1',b.id,
 json_object('id',NEW.id,'type','booking.reschedule-requested.v1','occurredAt',NEW.created_at,'data',json(json_object('bookingId',b.id,'eventTypeId',b.event_type_id,'state',b.state,'sequence',o.sequence,'startAt',o.start_at,'endAt',o.end_at,'durationMinutes',b.duration_minutes,'attribution',json(b.attribution_json)))),
 NEW.created_at,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+24 hours'),NEW.created_at,NEW.created_at
 FROM webhook_subscriptions s JOIN bookings b ON b.id=NEW.booking_id JOIN booking_occurrences o ON o.id=b.current_occurrence_id
 WHERE s.enabled=1 AND s.secret_ciphertext IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(s.events_json) WHERE value='booking.reschedule-requested.v1')
 AND (s.scope='workspace' OR (s.scope='host' AND s.scope_id=COALESCE((SELECT host_id FROM api_event_hosts WHERE event_type_id=b.event_type_id),(SELECT id FROM host_profiles WHERE singleton_key='default'))) OR (s.scope='team' AND (s.scope_id=NULL OR EXISTS(SELECT 1 FROM team_event_types te WHERE te.team_id=s.scope_id AND te.event_type_id=b.event_type_id))))
 AND (NOT EXISTS(SELECT 1 FROM person_erasure_locks l WHERE l.email=b.invitee_email_folded));
END;

DROP TRIGGER webhook_initial_payment;
CREATE TRIGGER webhook_initial_payment AFTER INSERT ON booking_payments WHEN 1 BEGIN
INSERT OR IGNORE INTO webhook_deliveries(id,subscription_id,event_id,event_type,booking_id,body_json,next_attempt_at,retry_until,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),s.id,'payment:' || NEW.booking_id,'booking.payment.v1',b.id,
 json_object('id','payment:' || NEW.booking_id,'type','booking.payment.v1','occurredAt',NEW.paid_at,'data',json(json_set(json_object('bookingId',b.id,'eventTypeId',b.event_type_id,'state',b.state,'sequence',o.sequence,'startAt',o.start_at,'endAt',o.end_at,'durationMinutes',b.duration_minutes,'attribution',json(b.attribution_json)),'$.payment',json_object('kind',NEW.kind,'amountCents',NEW.amount_cents,'currency',NEW.currency)))),
 NEW.paid_at,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.paid_at,'+24 hours'),NEW.paid_at,NEW.paid_at
 FROM webhook_subscriptions s JOIN bookings b ON b.id=NEW.booking_id JOIN booking_occurrences o ON o.id=b.current_occurrence_id
 WHERE s.enabled=1 AND s.secret_ciphertext IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(s.events_json) WHERE value='booking.payment.v1')
 AND (s.scope='workspace' OR (s.scope='host' AND s.scope_id=COALESCE((SELECT host_id FROM api_event_hosts WHERE event_type_id=b.event_type_id),(SELECT id FROM host_profiles WHERE singleton_key='default'))) OR (s.scope='team' AND (s.scope_id=NULL OR EXISTS(SELECT 1 FROM team_event_types te WHERE te.team_id=s.scope_id AND te.event_type_id=b.event_type_id))))
 AND (NOT EXISTS(SELECT 1 FROM person_erasure_locks l WHERE l.email=b.invitee_email_folded));
END;

DROP TRIGGER webhook_payment_movement;
CREATE TRIGGER webhook_payment_movement AFTER UPDATE OF status ON payment_movements WHEN NEW.status='succeeded' AND OLD.status<>'succeeded' BEGIN
INSERT OR IGNORE INTO webhook_deliveries(id,subscription_id,event_id,event_type,booking_id,body_json,next_attempt_at,retry_until,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),s.id,'movement:' || NEW.id,'booking.payment.v1',b.id,
 json_object('id','movement:' || NEW.id,'type','booking.payment.v1','occurredAt',NEW.updated_at,'data',json(json_set(json_object('bookingId',b.id,'eventTypeId',b.event_type_id,'state',b.state,'sequence',o.sequence,'startAt',o.start_at,'endAt',o.end_at,'durationMinutes',b.duration_minutes,'attribution',json(b.attribution_json)),'$.payment',json_object('kind',NEW.kind,'amountCents',NEW.amount_cents,'currency',NEW.currency)))),
 NEW.updated_at,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'+24 hours'),NEW.updated_at,NEW.updated_at
 FROM webhook_subscriptions s JOIN bookings b ON b.id=NEW.booking_id JOIN booking_occurrences o ON o.id=b.current_occurrence_id
 WHERE s.enabled=1 AND s.secret_ciphertext IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(s.events_json) WHERE value='booking.payment.v1')
 AND (s.scope='workspace' OR (s.scope='host' AND s.scope_id=COALESCE((SELECT host_id FROM api_event_hosts WHERE event_type_id=b.event_type_id),(SELECT id FROM host_profiles WHERE singleton_key='default'))) OR (s.scope='team' AND (s.scope_id=NULL OR EXISTS(SELECT 1 FROM team_event_types te WHERE te.team_id=s.scope_id AND te.event_type_id=b.event_type_id))))
 AND (NOT EXISTS(SELECT 1 FROM person_erasure_locks l WHERE l.email=b.invitee_email_folded));
END;

DROP TRIGGER webhook_poll_created;
CREATE TRIGGER webhook_poll_created AFTER INSERT ON meeting_polls BEGIN
INSERT OR IGNORE INTO webhook_deliveries(id,subscription_id,event_id,event_type,booking_id,body_json,next_attempt_at,retry_until,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),s.id,'poll:' || NEW.id || ':created','poll.created.v1',NULL,
 json_object('id','poll:' || NEW.id || ':created','type','poll.created.v1','occurredAt',NEW.created_at,'data',json(json_object('pollId',NEW.id,'eventTypeId',NEW.event_type_id))),
 NEW.created_at,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+24 hours'),NEW.created_at,NEW.created_at
 FROM webhook_subscriptions s
 WHERE s.enabled=1 AND s.secret_ciphertext IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(s.events_json) WHERE value='poll.created.v1')
 AND (s.scope='workspace' OR (s.scope='host' AND s.scope_id=COALESCE((SELECT host_id FROM api_event_hosts WHERE event_type_id=NEW.event_type_id),(SELECT id FROM host_profiles WHERE singleton_key='default'))) OR (s.scope='team' AND (s.scope_id=NULL OR EXISTS(SELECT 1 FROM team_event_types te WHERE te.team_id=s.scope_id AND te.event_type_id=NEW.event_type_id))))
 AND (1);
END;

DROP TRIGGER webhook_poll_closed;
CREATE TRIGGER webhook_poll_closed AFTER UPDATE OF state ON meeting_polls WHEN NEW.state='closed' AND OLD.state<>'closed' BEGIN
INSERT OR IGNORE INTO webhook_deliveries(id,subscription_id,event_id,event_type,booking_id,body_json,next_attempt_at,retry_until,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),s.id,'poll:' || NEW.id || ':closed','poll.closed.v1',NULL,
 json_object('id','poll:' || NEW.id || ':closed','type','poll.closed.v1','occurredAt',NEW.updated_at,'data',json(json_object('pollId',NEW.id,'eventTypeId',NEW.event_type_id))),
 NEW.updated_at,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'+24 hours'),NEW.updated_at,NEW.updated_at
 FROM webhook_subscriptions s
 WHERE s.enabled=1 AND s.secret_ciphertext IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(s.events_json) WHERE value='poll.closed.v1')
 AND (s.scope='workspace' OR (s.scope='host' AND s.scope_id=COALESCE((SELECT host_id FROM api_event_hosts WHERE event_type_id=NEW.event_type_id),(SELECT id FROM host_profiles WHERE singleton_key='default'))) OR (s.scope='team' AND (s.scope_id=NULL OR EXISTS(SELECT 1 FROM team_event_types te WHERE te.team_id=s.scope_id AND te.event_type_id=NEW.event_type_id))))
 AND (1);
END;

DROP TRIGGER webhook_poll_voted;
CREATE TRIGGER webhook_poll_voted AFTER UPDATE OF revision ON poll_participants WHEN NEW.revision>OLD.revision BEGIN
INSERT OR IGNORE INTO webhook_deliveries(id,subscription_id,event_id,event_type,booking_id,body_json,next_attempt_at,retry_until,created_at,updated_at)
 SELECT lower(hex(randomblob(16))),s.id,'vote:' || NEW.id || ':' || NEW.revision,'poll.voted.v1',NULL,
 json_object('id','vote:' || NEW.id || ':' || NEW.revision,'type','poll.voted.v1','occurredAt',NEW.updated_at,'data',json(json_object('pollId',NEW.poll_id,'revision',NEW.revision))),
 NEW.updated_at,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at,'+24 hours'),NEW.updated_at,NEW.updated_at
 FROM webhook_subscriptions s JOIN meeting_polls p ON p.id=NEW.poll_id
 WHERE s.enabled=1 AND s.secret_ciphertext IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(s.events_json) WHERE value='poll.voted.v1')
 AND (s.scope='workspace' OR (s.scope='host' AND s.scope_id=COALESCE((SELECT host_id FROM api_event_hosts WHERE event_type_id=p.event_type_id),(SELECT id FROM host_profiles WHERE singleton_key='default'))) OR (s.scope='team' AND (s.scope_id=NULL OR EXISTS(SELECT 1 FROM team_event_types te WHERE te.team_id=s.scope_id AND te.event_type_id=p.event_type_id))))
 AND (1);
END;
