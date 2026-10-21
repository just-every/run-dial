import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { paymentReturnSearch } from "../core/app/booking-search";
import { createFileRoute } from "@tanstack/react-router";
import { PaymentReturnPage } from "../core/features/public-booking/ui/payment-return-page";
import { PublicRecoveryPage } from "../core/features/public-booking/ui/recovery-page";

export const Route = createFileRoute('/book/$handle_/$slug_/paid')({ validateSearch: paymentReturnSearch, component: withEditorLeaf(PaymentReturnRoute) });
function PaymentReturnRoute() { const { handle, slug } = Route.useParams(); const search = Route.useSearch(); return search.return ? <PaymentReturnPage handle={handle} slug={slug} token={search.return} /> : <PublicRecoveryPage kind="booking" />; }
