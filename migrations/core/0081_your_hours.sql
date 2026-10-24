-- DL6: your hours have one home. One schedule is yours (is_default = 1). An event
-- uses yours, another named schedule, or hours of its own, and holidays and time
-- off are read from yours for every event. Each data step below acts only while
-- no schedule is yours, so a second run changes nothing; a backup made before
-- this update replays them after its restore (scripts/archive/your-hours.mjs).
ALTER TABLE availability_schedules ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1));
CREATE UNIQUE INDEX IF NOT EXISTS availability_schedules_one_default ON availability_schedules(is_default) WHERE is_default = 1;

-- Each published event's weekly windows as one text (weekday, start, end, in
-- order): its schedule's windows when bound, otherwise its own rows. An event
-- without windows has no hours to give.
CREATE TABLE your_hours_votes (
  event_type_id TEXT PRIMARY KEY,
  schedule_id TEXT,
  created_at TEXT NOT NULL,
  windows TEXT
);
INSERT INTO your_hours_votes (event_type_id, schedule_id, created_at, windows)
SELECT e.id, b.schedule_id, e.created_at, CASE WHEN b.schedule_id IS NULL
  THEN (SELECT group_concat(t, ',') FROM (
    SELECT w.weekday || ':' || w.start_minute || '-' || w.end_minute AS t
    FROM recurring_availability_windows w WHERE w.event_type_id = e.id
    ORDER BY w.weekday, w.start_minute, w.end_minute))
  ELSE (SELECT group_concat(t, ',') FROM (
    SELECT json_extract(j.value, '$.weekday') || ':' || json_extract(j.value, '$.startMinute') || '-' || json_extract(j.value, '$.endMinute') AS t
    FROM availability_schedules s, json_each(s.windows_json) j WHERE s.id = b.schedule_id
    ORDER BY json_extract(j.value, '$.weekday'), json_extract(j.value, '$.startMinute'), json_extract(j.value, '$.endMinute')))
  END
FROM event_types e LEFT JOIN event_schedule_bindings b ON b.event_type_id = e.id
WHERE e.status = 'published' AND NOT EXISTS (SELECT 1 FROM availability_schedules WHERE is_default = 1);
DELETE FROM your_hours_votes WHERE windows IS NULL;

-- The windows the most published events use win; a tie goes to the group that
-- holds the earliest-created published event.
CREATE TABLE your_hours_choice (
  windows TEXT,
  first_event_id TEXT,
  schedule_id TEXT
);
INSERT INTO your_hours_choice (windows, first_event_id)
SELECT v.windows, (SELECT x.event_type_id FROM your_hours_votes x WHERE x.windows = v.windows ORDER BY x.created_at, x.event_type_id LIMIT 1)
FROM your_hours_votes v
GROUP BY v.windows
ORDER BY count(*) DESC, min(v.created_at || ' ' || v.event_type_id)
LIMIT 1;
-- A winning group that includes a schedule makes it yours: the schedule of the group's earliest bound event.
UPDATE your_hours_choice SET schedule_id = (
  SELECT v.schedule_id FROM your_hours_votes v
  WHERE v.windows = your_hours_choice.windows AND v.schedule_id IS NOT NULL
  ORDER BY v.created_at, v.event_type_id LIMIT 1);
-- No published event with hours: the earliest schedule becomes yours, if there is one.
INSERT INTO your_hours_choice (schedule_id)
SELECT id FROM availability_schedules
WHERE NOT EXISTS (SELECT 1 FROM your_hours_choice) AND NOT EXISTS (SELECT 1 FROM availability_schedules WHERE is_default = 1)
ORDER BY created_at, id LIMIT 1;
-- Otherwise "Your hours" is made with the winning windows.
UPDATE your_hours_choice SET schedule_id = '0' || substr(upper(hex(randomblob(13))), 1, 25)
WHERE schedule_id IS NULL AND windows IS NOT NULL;
INSERT INTO availability_schedules (id, name, windows_json, block_us_holidays, reopened_holidays_json, time_off_json, created_at, updated_at)
SELECT c.schedule_id, 'Your hours',
  (SELECT json_group_array(json_object('weekday', w.weekday, 'startMinute', w.start_minute, 'endMinute', w.end_minute)) FROM (
    SELECT weekday, start_minute, end_minute FROM recurring_availability_windows
    WHERE event_type_id = c.first_event_id ORDER BY weekday, start_minute, end_minute) w),
  0, '[]', '[]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM your_hours_choice c
WHERE c.schedule_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM availability_schedules s WHERE s.id = c.schedule_id);
-- The group's events without a schedule use yours. Their weekly rows already hold
-- these windows, which is how a bound event keeps its schedule's windows.
INSERT INTO event_schedule_bindings (event_type_id, schedule_id, created_at, updated_at)
SELECT v.event_type_id, c.schedule_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM your_hours_votes v JOIN your_hours_choice c ON c.windows = v.windows
WHERE v.schedule_id IS NULL;

-- Yours takes every time off of the schedules published events use (and its
-- own), holidays on if any of them had them, and a reopened holiday only where
-- every one of them with holidays on reopened it. No event gains a slot.
CREATE TABLE your_hours_closures (
  time_off_json TEXT NOT NULL,
  block_us_holidays INTEGER NOT NULL,
  reopened_holidays_json TEXT
);
INSERT INTO your_hours_closures (time_off_json, block_us_holidays, reopened_holidays_json)
SELECT
  (SELECT json_group_array(json_object('startDate', r.start_date, 'endDate', r.end_date)) FROM (
    SELECT DISTINCT json_extract(t.value, '$.startDate') AS start_date, json_extract(t.value, '$.endDate') AS end_date
    FROM availability_schedules f, json_each(f.time_off_json) t
    WHERE f.id = c.schedule_id OR f.id IN (SELECT b.schedule_id FROM event_schedule_bindings b JOIN event_types e ON e.id = b.event_type_id WHERE e.status = 'published')
    ORDER BY start_date, end_date) r),
  (SELECT max(f.block_us_holidays) FROM availability_schedules f
    WHERE f.id = c.schedule_id OR f.id IN (SELECT b.schedule_id FROM event_schedule_bindings b JOIN event_types e ON e.id = b.event_type_id WHERE e.status = 'published')),
  (SELECT json_group_array(d.value) FROM (
    SELECT r.value FROM availability_schedules f, json_each(f.reopened_holidays_json) r
    WHERE f.block_us_holidays = 1 AND (f.id = c.schedule_id OR f.id IN (SELECT b.schedule_id FROM event_schedule_bindings b JOIN event_types e ON e.id = b.event_type_id WHERE e.status = 'published'))
    GROUP BY r.value
    HAVING count(DISTINCT f.id) = (SELECT count(*) FROM availability_schedules g
      WHERE g.block_us_holidays = 1 AND (g.id = c.schedule_id OR g.id IN (SELECT b.schedule_id FROM event_schedule_bindings b JOIN event_types e ON e.id = b.event_type_id WHERE e.status = 'published')))
    ORDER BY r.value) d)
FROM your_hours_choice c WHERE c.schedule_id IS NOT NULL;
-- With no holidays on, yours keeps its own reopened dates.
UPDATE your_hours_closures SET reopened_holidays_json = NULL WHERE block_us_holidays = 0;
UPDATE availability_schedules SET
  time_off_json = (SELECT time_off_json FROM your_hours_closures),
  block_us_holidays = (SELECT block_us_holidays FROM your_hours_closures),
  reopened_holidays_json = coalesce((SELECT reopened_holidays_json FROM your_hours_closures), reopened_holidays_json),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = (SELECT schedule_id FROM your_hours_choice) AND EXISTS (SELECT 1 FROM your_hours_closures k WHERE
  k.time_off_json IS NOT availability_schedules.time_off_json OR k.block_us_holidays IS NOT availability_schedules.block_us_holidays
  OR coalesce(k.reopened_holidays_json, availability_schedules.reopened_holidays_json) IS NOT availability_schedules.reopened_holidays_json);
-- The engine reads holidays and time off from yours only, so the other schedules' return to their defaults.
UPDATE availability_schedules SET block_us_holidays = 0, reopened_holidays_json = '[]', time_off_json = '[]', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id <> (SELECT schedule_id FROM your_hours_choice) AND (block_us_holidays <> 0 OR reopened_holidays_json <> '[]' OR time_off_json <> '[]');
UPDATE availability_schedules SET is_default = 1
WHERE id = (SELECT schedule_id FROM your_hours_choice) AND NOT EXISTS (SELECT 1 FROM availability_schedules WHERE is_default = 1);
DROP TABLE your_hours_closures;
DROP TABLE your_hours_choice;
DROP TABLE your_hours_votes;
