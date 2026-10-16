import { loadPrivateShell } from "../core/app/loaders";
import { createFileRoute } from "@tanstack/react-router";
import { primaryFontPreload } from "../core/features/public-site/chrome/font-head";
import { AppShell } from "../core/app/ui/app-shell";


export const Route = createFileRoute('/app' )({ codeSplitGroupings: [], shouldReload: true, head: () => ({ links: [primaryFontPreload] }), beforeLoad: async ({ location }) => ({ shell: await loadPrivateShell({ data: { path: location.href } }) }), loader: ({ context }) => context.shell, component: AppShell });

