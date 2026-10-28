import { createFileRoute } from "@tanstack/react-router";
import { RoutingPage } from "../core/features/routing/client";
export const Route=createFileRoute("/route/$slug")({component:Page});
function Page(){const {slug}=Route.useParams();return <RoutingPage slug={slug}/>;}
