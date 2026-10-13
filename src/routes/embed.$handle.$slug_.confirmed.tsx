import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { bookingConfirmationSearch } from "../core/app/booking-search";
import { createFileRoute } from "@tanstack/react-router";
import { BookingConfirmationPage } from "../core/features/public-booking/ui/event-page";
import { PublicRecoveryPage } from "../core/features/public-booking/ui/recovery-page";


export const Route = createFileRoute('/embed/$handle/$slug_/confirmed' )({ validateSearch: bookingConfirmationSearch, component: withEditorLeaf(EmbeddedConfirmedRoute) });
function EmbeddedConfirmedRoute() { const { token } = Route.useSearch(); return token ? <BookingConfirmationPage token={token} embedded /> : <PublicRecoveryPage kind="booking" />; }
