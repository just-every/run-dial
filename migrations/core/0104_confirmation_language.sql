-- Existing event types retain the English built-in confirmation until explicitly changed.
ALTER TABLE event_types ADD COLUMN confirmation_language TEXT NOT NULL DEFAULT 'en'
 CHECK(confirmation_language IN ('en', 'es'));
