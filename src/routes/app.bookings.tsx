import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { BookingsPage } from "../core/features/bookings/ui/bookings-page";


export const Route = createFileRoute('/app/bookings' )({ codeSplitGroupings: [], component: withEditorLeaf(BookingsPage) });

