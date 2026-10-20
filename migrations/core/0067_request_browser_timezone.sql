-- Keep the invitee observation separate from the zone used to compose windows.
-- Historical requests have no observation; never infer one from their display zone.
ALTER TABLE availability_requests ADD COLUMN browser_timezone TEXT;
