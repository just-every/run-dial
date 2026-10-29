# CSV and calendar move-in templates

In Settings → Move in, select four UTF-8 files together. These templates work
for Doodle or another scheduler whose data you can export or transcribe. Dial
never contacts that account. Each capture belongs to one stable source account.
Keep its account ID and record IDs unchanged when capturing again.

The files are `source.json`, `event-types.csv`, `availability.csv` and exactly
one of `bookings.csv` or `bookings.ics`. CSV uses a header row, commas, doubled
quotes inside quoted fields and quotes around a field containing a comma or
newline. An empty bookings file still has its header row. All times and IDs must
come from the source; the examples below are templates to edit.

`source.json` identifies the source and its capture time:

```json
{"version":1,"accountId":"my-scheduler","name":"My workspace","handle":"my-workspace","timezone":"UTC","capturedAt":"2027-01-01T00:00:00.000Z"}
```

`event-types.csv`:

```csv
id,title,slug,description,duration,color,listed,location_type,location_value
consultation,Consultation,consultation,Project consultation,30,#176b5a,true,in_person,Main office
```

Duration is in minutes. Listed is `true` or `false`. Location type is
`in_person`, `fixed_link` (an HTTPS meeting URL), or `phone` (the host's number).
Every event arrives as a draft. No source payment, workflow or message settings
are enabled automatically.

`availability.csv`:

```csv
event_type_id,kind,day,start,end
consultation,weekly,monday,09:00,17:00
consultation,date,2027-01-12,,
```

Weekly rows use full lowercase weekday names. Date rows use ISO dates; an empty
start and end close that date. Times are wall-clock `HH:MM` in the source zone.
If Dial already uses a different host zone, explicitly adopt the source zone or
skip its availability in the preview. A file with no availability has only its
header; the preview tells you to configure availability.

`bookings.csv` header:

```csv
id,event_type_id,title,start,end,created_at,name,email,timezone,location_type,location_value,status,answers
```

Use the source booking's stable ID, its event ID, ISO instants with explicit
offsets, the original creation instant, the invitee's real name and address,
an IANA timezone, a complete source location, and status `confirmed` or
`cancelled`. Answers is blank or a JSON array of objects with `question`,
`answer` and integer `position` fields. Quote that JSON as a CSV field.
Do not place API credentials in any file.

Alternatively, `bookings.ics` contains a VCALENDAR with VERSION:2.0 and
PRODID, then one VEVENT per booking. Required properties are:

| Property | Value |
| --- | --- |
| UID | Stable source booking ID |
| X-DIAL-EVENT-TYPE-ID | ID in the event types file |
| SUMMARY | Booking title |
| DTSTART, DTEND, CREATED | UTC instant such as `20270105T150000Z` |
| ATTENDEE | A `mailto:` URI, with the invitee's name in its CN parameter |
| X-DIAL-INVITEE-TIMEZONE | IANA timezone |
| X-DIAL-LOCATION-TYPE | Same location types as CSV |
| LOCATION | Complete source meeting location |
| STATUS | CONFIRMED or CANCELLED |
| X-DIAL-ANSWERS | Optional JSON answers array, with calendar text escaping |

Calendar text supports folded lines and escaped newlines, commas, semicolons
and backslashes. Recurrence must be expanded into individual bookings first.
Duplicate properties, multiple invitees and local or all-day instants are
refused rather than guessed.

Preview lists every unconsumed field by its source name, plus changed defaults,
skipped events and rejected bookings. Download its report and acknowledge the
losses before applying. Future single-invitee bookings occupy time silently;
past, cancelled and overlapping bookings are listed instead of imported. Review
every draft before publishing. Apply, resume, undo, source identity, private
capabilities and erasure follow the [move-in rules](importing.md).
