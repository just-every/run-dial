import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "../core/features/host-profile/ui/profile-page";


export const Route = createFileRoute('/setup/profile' )({ component: ProfilePage });

