import { loadPrivateShell } from "../core/app/loaders";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "../core/app/ui/app-shell";


export const Route = createFileRoute('/app' )({ codeSplitGroupings: [], beforeLoad: async () => ({ shell: await loadPrivateShell() }), loader: ({ context }) => context.shell, component: AppShell });

