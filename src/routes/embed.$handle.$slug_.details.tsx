import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { bookingDetailsSearch, detailsCapability } from "../core/app/booking-search";
import { createFileRoute } from "@tanstack/react-router";
import { BookingDetailsPage } from "../core/features/public-booking/ui/event-page";
import { PublicRecoveryPage } from "../core/features/public-booking/ui/recovery-page";


export const Route = createFileRoute('/embed/$handle/$slug_/details' )({ validateSearch: bookingDetailsSearch, component: withEditorLeaf(EmbeddedDetailsRoute) });
function EmbeddedDetailsRoute() { const { handle, slug } = Route.useParams(); const capability = detailsCapability(Route.useSearch()); return capability ? <BookingDetailsPage handle={handle} slug={slug} capability={capability} embedded /> : <PublicRecoveryPage kind="booking" />; }
