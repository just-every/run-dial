import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { CreateBookingPage } from "../core/features/bookings/ui/create-booking-page";


export const Route = createFileRoute('/app/bookings_/new' )({ codeSplitGroupings: [], component: withEditorLeaf(CreateBookingPage) });

