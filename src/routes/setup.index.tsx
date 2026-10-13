import { createFileRoute } from "@tanstack/react-router";
import { FirstRunPage } from "../core/features/host-setup/ui/first-run-page";
export const Route = createFileRoute('/setup/')({ component: FirstRunPage });
