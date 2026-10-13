-- Existing bookings retain their managed-calendar obligation. New schedule-only
-- bookings persist absence separately from the provider delivery state.
ALTER TABLE bookings ADD COLUMN calendar_required INTEGER NOT NULL DEFAULT 1 CHECK (calendar_required IN (0, 1));
