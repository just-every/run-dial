import { loadPrivateShell } from "../core/app/loaders";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../core/app/ui/app-shell";


export const Route = createFileRoute('/app' )({ codeSplitGroupings: [], shouldReload: true, beforeLoad: async ({ location }) => ({ shell: await loadPrivateShell({ data: { path: location.href } }) }), loader: ({ context }) => context.shell, component: AppShell });

