# Native agent registry

Dial declares synchronous native work under `tools`, `policy`, `pause`, `audit`, and `idempotency`. Every call requires the current sponsoring native owner's authority. Classes below are the possible server-computed classes; the proposed effect and current records determine the actual classes.

Tools that prepare queued work, administer providers or require a native human act remain outside this registry. [The adoption guide](README.md) lists each excluded verb, native location, clauses and reason. No provider cost is registered. The built-in `dial.events.list` uses Base's retained-event adapter (`modules/agent-door/events.ts`), its closed cursor/limit schema and access filtering. Complete product change feeds, subscriptions and webhook delivery remain undeclared.

| Tool | Scope | Access | Possible classes | Clauses |
| --- | --- | --- | --- | --- |
| `dial.events.list` | `events:read` | read | standard | `BASE-AGENT-010` |
| `dial.profile.get` | `dial:read` | read | standard | `PROFILE-001`, `PROFILE-002` |
| `dial.profile.save` | `dial:write` | write | live, external | `PROFILE-001`, `PROFILE-002`, `AVAIL-005` |
| `dial.event.list` | `dial:read` | read | standard | `EVENT-001` |
| `dial.event.get` | `dial:read` | read | standard | `EVENT-001`, `EVENT-002`, `EVENT-003`, `EVENT-004` |
| `dial.event.create` | `dial:write` | write | standard | `EVENT-001`, `EVENT-002`, `EVENT-003`, `EVENT-004`, `EVENT-011`, `NOTIFY-009` |
| `dial.event.duplicate` | `dial:write` | write | standard | `EVENT-001`, `NOTIFY-009`, `AVAIL-011` |
| `dial.event.update_details` | `dial:write` | write | standard, live, external | `EVENT-001`, `EVENT-002`, `EVENT-003`, `EVENT-004`, `EVENT-011`, `NOTIFY-009` |
| `dial.event.update` | `dial:write` | write | standard, live, external | `EVENT-001`, `EVENT-002`, `EVENT-003`, `EVENT-004`, `EVENT-011`, `NOTIFY-009`, `AVAIL-001`, `AVAIL-011` |
| `dial.event.set_alternative_requests` | `dial:write` | write | standard, live, external | `EVENT-001`, `EVENT-006`, `REQUEST-001` |
| `dial.event.readiness` | `dial:read` | read | standard | `EVENT-006`, `CAL-006` |
| `dial.event.preview` | `dial:read` | read | standard | `EVENT-001`, `PROFILE-001` |
| `dial.event.publish` | `dial:write` | write | live, external | `EVENT-001`, `EVENT-006`, `AVAIL-004` |
| `dial.event.open_requests` | `dial:write` | write | live, external | `EVENT-006`, `REQUEST-001`, `REQUEST-004` |
| `dial.event.disable` | `dial:write` | write | standard, live, external | `EVENT-001`, `EVENT-005` |
| `dial.event.delete` | `dial:write` | write | live, external, destructive | `EVENT-001`, `EVENT-005` |
| `dial.event.replace_availability` | `dial:write` | write | standard, live, external | `EVENT-002`, `AVAIL-001`, `AVAIL-011` |
| `dial.event.list_date_overrides` | `dial:read` | read | standard | `AVAIL-001` |
| `dial.event.save_date_override` | `dial:write` | write | standard, live, external | `AVAIL-001`, `AVAIL-005`, `EVENT-002` |
| `dial.event.delete_date_override` | `dial:write` | write | live, external, destructive | `AVAIL-001`, `AVAIL-005` |
| `dial.event.get_policy` | `dial:read` | read | standard | `AVAIL-012`, `BOOK-015` |
| `dial.event.save_policy` | `dial:write` | write | standard, live, external | `AVAIL-012`, `BOOK-015`, `PAY-003` |
| `dial.event.get_correspondence` | `dial:read` | read | standard | `NOTIFY-009`, `REQUEST-004` |
| `dial.event.save_correspondence` | `dial:write` | write | standard, live, external | `NOTIFY-009`, `NOTIFY-008`, `REQUEST-004`, `CAL-003` |
| `dial.event.get_approval` | `dial:read` | read | standard | `EVENT-008` |
| `dial.event.save_approval` | `dial:write` | write | standard, live, external | `EVENT-008` |
| `dial.event.get_guests` | `dial:read` | read | standard | `EVENT-009` |
| `dial.event.save_guests` | `dial:write` | write | standard, live, external | `EVENT-009` |
| `dial.availability.get_hours` | `dial:read` | read | standard | `AVAIL-001`, `AVAIL-010`, `AVAIL-011` |
| `dial.availability.choose_event_hours` | `dial:write` | write | standard, live, external | `AVAIL-001`, `AVAIL-011` |
| `dial.availability.get_limits` | `dial:read` | read | standard | `AVAIL-010` |
| `dial.availability.save_limits` | `dial:write` | write | standard, live, external | `AVAIL-010` |
| `dial.availability.diagnose` | `dial:read` | read | standard | `AVAIL-009`, `AVAIL-004`, `EVENT-011` |
| `dial.availability.list_schedules` | `dial:read` | read | standard | `AVAIL-011` |
| `dial.availability.get_schedule` | `dial:read` | read | standard | `AVAIL-011` |
| `dial.availability.create_schedule` | `dial:write` | write | standard | `AVAIL-011` |
| `dial.availability.save_schedule` | `dial:write` | write | standard, live, external | `AVAIL-001`, `AVAIL-011` |
| `dial.availability.save_closures` | `dial:write` | write | standard, live, external | `AVAIL-001`, `AVAIL-011` |
| `dial.calendar.setup` | `dial:read` | read | standard | `CAL-001` |
| `dial.calendar.health` | `dial:read` | read | standard | `CAL-001`, `CAL-006` |
| `dial.calendar.list` | `dial:read` | read | standard | `CAL-001`, `CAL-002`, `CAL-010` |
| `dial.calendar.select` | `dial:write` | write | live, external | `CAL-001`, `CAL-006`, `CAL-010` |
| `dial.calendar.grants` | `dial:read` | read | standard | `CAL-001` |
| `dial.calendar.disconnect` | `dial:write` | write | access, live, destructive | `CAL-001`, `CAL-006`, `AVAIL-004` |
| `dial.bookings.list` | `dial:read` | read | sensitive | `BOOK-004`, `REPORT-002` |
| `dial.bookings.read` | `dial:read` | read | sensitive | `BOOK-004`, `BOOK-010`, `BOOK-011`, `PAY-003` |
| `dial.bookings.approvals_list` | `dial:read` | read | sensitive | `BOOK-002`, `PAY-007` |
| `dial.bookings.calendar_deletion_status` | `dial:read` | read | sensitive | `CAL-008`, `CAL-005`, `AGENT-004` |
| `dial.requests.list` | `dial:read` | read | sensitive | `REQUEST-003` |
| `dial.requests.read` | `dial:read` | read | sensitive | `REQUEST-003` |
| `dial.reports.scheduling` | `dial:read` | read | sensitive | `REPORT-001`, `PAY-003` |
| `dial.reports.drill_through` | `dial:read` | read | sensitive | `REPORT-001`, `REPORT-002` |
| `dial.delivery.list` | `dial:read` | read | sensitive | `NOTIFY-005`, `CAL-005` |
| `dial.delivery.preferences_read` | `dial:read` | read | standard | `NOTIFY-008` |
| `dial.delivery.preferences_update` | `dial:write` | write | standard | `NOTIFY-008` |
| `dial.delivery.health` | `dial:read` | read | standard | `NOTIFY-005`, `NOTIFY-007` |
| `dial.delivery.check` | `dial:write` | write | standard, live | `NOTIFY-005`, `NOTIFY-007` |
| `dial.clients.list` | `dial:read` | read | sensitive | `CLIENT-001` |
| `dial.clients.history` | `dial:read` | read | sensitive | `CLIENT-001`, `CUSTOM-002` |
| `dial.clients.add_note` | `dial:write` | write | standard | `CLIENT-001` |
| `dial.clients.add_field` | `dial:write` | write | standard | `CLIENT-001` |
| `dial.clients.merge` | `dial:write` | write | standard, destructive | `CLIENT-001` |
| `dial.polls.grants` | `dial:read` | read | standard | `POLL-001` |
| `dial.polls.list` | `dial:read` | read | standard | `POLL-001` |
| `dial.polls.read` | `dial:read` | read | sensitive | `POLL-001` |
| `dial.polls.set_tally` | `dial:write` | write | standard, access | `POLL-001` |
| `dial.polls.close` | `dial:write` | write | standard, access, live | `POLL-001` |
| `dial.booking_links.grants` | `dial:read` | read | standard | `LINK-001`, `LINK-002` |
| `dial.booking_links.list` | `dial:read` | read | standard | `LINK-001`, `LINK-002` |
| `dial.booking_links.revoke` | `dial:write` | write | standard, access, live | `LINK-001`, `LINK-002` |
| `dial.custom_fields.list` | `dial:read` | read | standard | `CUSTOM-001`, `CUSTOM-002` |
| `dial.custom_fields.create` | `dial:write` | write | standard | `CUSTOM-001`, `CUSTOM-002` |
| `dial.custom_fields.remove` | `dial:write` | write | destructive | `CUSTOM-001`, `CUSTOM-002` |
| `dial.custom_fields.read` | `dial:read` | read | sensitive | `CUSTOM-001`, `CUSTOM-002` |
| `dial.custom_fields.set` | `dial:write` | write | standard, destructive | `CUSTOM-001`, `CUSTOM-002` |
| `dial.site_look.apply` | `dial:write` | write | live, external | `BRAND-001` |
| `dial.site_look.read` | `dial:read` | read | standard | `BRAND-001` |
| `dial.site_look.change` | `dial:write` | write | live | `BRAND-001` |
| `dial.site_look.clear` | `dial:write` | write | standard, live, destructive | `BRAND-001` |
| `dial.payments.price_get` | `dial:read` | read | standard | `PAY-001` |
| `dial.payments.price_set` | `dial:write` | write | standard, live, external | `PAY-001`, `PAY-003` |
| `dial.payments.terms_get` | `dial:read` | read | standard | `PAY-003` |
| `dial.payments.terms_set` | `dial:write` | write | standard, live, external | `PAY-003` |
| `dial.payments.settings_get` | `dial:read` | read | standard | `PAY-005` |
| `dial.payments.settings_set` | `dial:write` | write | live | `PAY-005` |
| `dial.payments.booking_money` | `dial:read` | read | sensitive | `PAY-001`, `PAY-003`, `PAY-005`, `PAY-006` |
| `dial.accounting.reconciliation` | `dial:read` | read | sensitive | `PAY-006` |
| `dial.accounting.csv` | `dial:read` | read | sensitive | `PAY-006` |
| `dial.accounting.status` | `dial:read` | read | standard | `PAY-006` |
| `dial.entitlements.list` | `dial:read` | read | sensitive | `PAY-004` |
| `dial.entitlements.products` | `dial:read` | read | standard | `PAY-004` |
| `dial.entitlements.product_define` | `dial:write` | write | standard, live, external | `PAY-004` |
| `dial.notices.status` | `dial:read` | read | standard | `FLOW-005` |

## Prepared resources

The ten readers below are not mounted or declared as the `resources` capability. Their native owner and record-visibility checks are implemented, but the complete resource policy, approval and refresh journey remains outstanding. Use the declared read tools for supported native record inspection. Each prepared reader declares the `sensitive` class and classifies the returned record.

| Template | Native record |
| --- | --- |
| `dial://bookings/{id}` | Booking |
| `dial://occurrences/{id}` | Booking occurrence |
| `dial://deliveries/{id}` | Delivery status |
| `dial://payments/{id}` | Booking payment |
| `dial://clients/{id}` | Client record |
| `dial://hosts/{id}` | Host profile |
| `dial://event-types/{id}` | Event type |
| `dial://schedules/{id}` | Availability schedule |
| `dial://requests/{id}` | Alternative time request |
| `dial://polls/{id}` | Meeting poll |

The specialist prompt and discovery describe the company-agent door. Native OAuth, provider setup, installation, import and screen-only confirmation retain their own credentials and person lifecycle. MCP supports `2026-07-28` and `2025-11-25`; March `2025-03-26` is refused.
