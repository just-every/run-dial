import { NoticeDestinationsCard } from '../core/features/workspace-notices/ui/destinations-card';
import { AccountingCard } from "../core/features/payments/ui/accounting-card";
import { StripeConnectionCard } from "../core/features/payments/ui/stripe-connection-card";
import { PersonErasureCard } from "../core/features/erasure/ui/person-erasure";
import { MoveInCard } from "../core/features/move-in/ui/move-in-card";
import { SwitchOverCard } from "../core/features/move-in/ui/switch-over-card";
import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { EmbedSettingsCard } from "../core/features/embeds/ui/embed-settings";
import { SettingsPage } from "../core/features/operators/ui/settings-page";
import { BlockedAddressesCard } from "../core/features/public-abuse/ui/blocked-addresses";
import { MailPreferencesCard } from "../core/features/delivery/ui/mail-preferences";
import { ArchiveStatusCard } from "../core/features/portability/status-card";


export const Route = createFileRoute('/app/settings' )({ codeSplitGroupings: [], component: withEditorLeaf(SettingsRoute) });

function SettingsRoute() {
  const { shell } = Route.useRouteContext();
  return <><SettingsPage paymentSettings={timezone => <><StripeConnectionCard timezone={timezone} /><AccountingCard /><NoticeDestinationsCard /></>} privacySettings={<PersonErasureCard />} embedSettings={<EmbedSettingsCard publicOrigin={shell.publicOrigin} />} blockingSettings={<BlockedAddressesCard />} mailPreferences={<MailPreferencesCard />} />{shell.canInspectArchive ? <ArchiveStatusCard /> : null}<div className="mt-7"><MoveInCard /></div><SwitchOverCard className="mt-7" /></>;
}
