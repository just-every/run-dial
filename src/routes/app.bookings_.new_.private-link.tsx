import { createFileRoute } from "@tanstack/react-router";
import { PrivateLinkPage } from "../core/features/booking-links/client";

export const Route = createFileRoute('/app/bookings_/new_/private-link')({ codeSplitGroupings: [], component: PrivateLinkPage });
