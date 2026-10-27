import { createFileRoute, redirect } from "@tanstack/react-router";


export const Route = createFileRoute('/app/availability' )({ beforeLoad: () => { throw redirect({ to: "/app/settings/hours", replace: true }); } });

