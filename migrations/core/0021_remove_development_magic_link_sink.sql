-- Local sign-in mail now uses the bounded Base development outbox.
-- Applied migration history is immutable; retire only the obsolete credential sink.
DROP TABLE development_magic_link_sink;
