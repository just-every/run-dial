-- Existing event and retained booking correspondence continues to send confirmations.
UPDATE event_correspondence SET templates_json = json_set(templates_json, '$.inviteeConfirmationEnabled', json('true'))
WHERE json_type(templates_json, '$.inviteeConfirmationEnabled') IS NULL;
UPDATE booking_correspondence SET templates_json = json_set(templates_json, '$.inviteeConfirmationEnabled', json('true'))
WHERE json_type(templates_json, '$.inviteeConfirmationEnabled') IS NULL;
