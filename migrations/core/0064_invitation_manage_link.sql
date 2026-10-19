-- Shared invitations email booking access to the invitee by default. Retained
-- correspondence carries the choice after an event type is deleted.
UPDATE event_correspondence SET templates_json = json_set(templates_json, '$.invitationManageLinkEnabled', json('true'))
WHERE json_type(templates_json, '$.invitationManageLinkEnabled') IS NULL;
UPDATE booking_correspondence SET templates_json = json_set(templates_json, '$.invitationManageLinkEnabled', json('true'))
WHERE json_type(templates_json, '$.invitationManageLinkEnabled') IS NULL;
