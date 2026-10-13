-- Existing owners keep workspace access when upgrading. This compatibility marker
-- does not assert that historical first-run checklist actions were performed.
ALTER TABLE operator_setup_identity ADD COLUMN onboarding_completed_at TEXT;
UPDATE operator_setup_identity SET onboarding_completed_at=created_at;
