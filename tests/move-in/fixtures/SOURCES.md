# Public format references

- https://developer.calendly.com/api-docs/calendly-api/users/get-current-user
- https://developer.calendly.com/api-docs/calendly-api/event-types/list-event-types
- https://developer.calendly.com/api-docs/calendly-api/event-types/get-event-type
- https://developer.calendly.com/api-docs/calendly-api/availability/list-user-availability-schedules
- https://developer.calendly.com/api-docs/calendly-api/availability/get-event-type-availability
- https://developer.calendly.com/api-docs/calendly-api/scheduled-events/list-scheduled-events
- https://developer.calendly.com/api-docs/calendly-api/scheduled-events/list-event-invitees
- https://developer.calendly.com/docs/api-guides/view-event-type-and-user-calendar-availability-data
- https://calendly.com/help/how-to-fine-tune-your-availability-settings
- https://calendly.com/help/tracking-and-reporting
- https://developers.cloudflare.com/d1/platform/limits/

# Assumptions and decisions

These are hand-authored synthetic responses, dated in 2027, checked with an explicit
2027-01-01 as-of instant. They are not captured from an account. Expected files
were written from the fixture narrative, independently of the importer.

The event-type read API does not carry event buffer/notice/horizon/daily-limit or
start-increment configuration. Dial uses its documented defaults and lists all six
settings as changed. Membership buffered start/end instants do carry each booked
occurrence's actual occupied interval and are retained. No unsupported scheduling
setting is invented in the source fixtures.

Schedule association comes from event_type_availability_schedules, not a guessed
event-type field. User schedules alone do not establish association. Missing
association is reported and requires configuration in Dial. Multiple associated
hosts, groups, polling and ad hoc meetings cannot become a single-host event.

The documented API uses kind=solo, type=StandardEventType, pooling_type and a
boolean secret visibility field; it uses string/text/single_select/multi_select
question types. Existing scheduled-event duration comes from actual start/end
instants, not the event-type's current duration.

Public help establishes that CSV exports exist, but the reviewed help pages do
not specify a complete stable column and value schema for a saved scheduled-event
export. No CSV booking path is implemented. Save API responses instead.

Source URI identifiers use the documented API origin with synthetic identifiers.
All invitee addresses, destination URLs and phone numbers are reserved examples.
URLs that can cancel or reschedule source bookings are retained only in private
exact originals and normalized booking source. Dial never invokes them or presents
them as its manage capabilities. Capturing a response retains its whole envelope.
Erasure explicitly withdraws all raw pages in affected jobs, including composite
invitee/event pages, and preserves only normalized non-erased peers and job progress.
