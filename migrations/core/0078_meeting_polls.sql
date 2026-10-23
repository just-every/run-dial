CREATE TABLE meeting_polls (
 id TEXT PRIMARY KEY, event_type_id TEXT NOT NULL REFERENCES event_types(id), title TEXT NOT NULL,
 closes_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed')),
 show_tally INTEGER NOT NULL DEFAULT 0 CHECK(show_tally IN(0,1)), hold_link_id TEXT REFERENCES booking_links(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE poll_candidates (
 id TEXT PRIMARY KEY, poll_id TEXT NOT NULL REFERENCES meeting_polls(id) ON DELETE CASCADE,
 start_at TEXT NOT NULL, end_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(poll_id,start_at)
);
CREATE TABLE poll_participants (
 id TEXT PRIMARY KEY, poll_id TEXT NOT NULL REFERENCES meeting_polls(id) ON DELETE CASCADE,
 name TEXT NOT NULL, email TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(poll_id,email)
);
CREATE TABLE poll_vote_tokens (
 participant_id TEXT PRIMARY KEY REFERENCES poll_participants(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE poll_votes (
 participant_id TEXT NOT NULL REFERENCES poll_participants(id) ON DELETE CASCADE,
 candidate_id TEXT NOT NULL REFERENCES poll_candidates(id) ON DELETE CASCADE,
 choice TEXT NOT NULL CHECK(choice IN('yes','if_needed','no')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(participant_id,candidate_id)
);
CREATE TRIGGER poll_participant_erasure_insert BEFORE INSERT ON poll_participants
WHEN EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=NEW.email)
BEGIN SELECT RAISE(ABORT,'person_erasure_pending'); END;
CREATE TRIGGER poll_participant_erasure_update BEFORE UPDATE ON poll_participants
WHEN EXISTS(SELECT 1 FROM person_erasure_locks WHERE email=NEW.email)
BEGIN SELECT RAISE(ABORT,'person_erasure_pending'); END;
CREATE TRIGGER poll_vote_erasure_insert BEFORE INSERT ON poll_votes
WHEN EXISTS(SELECT 1 FROM poll_participants p JOIN person_erasure_locks l ON l.email=p.email WHERE p.id=NEW.participant_id)
BEGIN SELECT RAISE(ABORT,'person_erasure_pending'); END;
