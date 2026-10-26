import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { useWorkspaceRead } from "../../../app/workspace-reads";
import { HostAvatar } from "./host-avatar";
import { AvatarEditor } from "./avatar-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { PageHeader, SectionHeading } from "../../../app/ui/page-header";
import { Button, Card, Input, Textarea, noticeClassName } from "../../../app/ui/primitives";
import { useHydrated } from "../../../app/use-hydrated";
import { TimezonePicker } from "../../../shared/timezone-picker";
import type { ProfileInput, ProfileRecord } from "../repository";

export function ProfilePage() {
  const hydrated = useHydrated();
  const inFlight = useRef(false);
  const loadEpoch = useRef(0);
  const edited = useRef(false);
  const initialProfile = useWorkspaceRead<ProfileRecord>("/api/app/profile");
  const [profile, setProfile] = useState<ProfileInput | ProfileRecord | undefined>(initialProfile);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current; setError("");
    try {
      const response = await api.api.app.profile.$get();
      if (epoch !== loadEpoch.current) return;
      if (response.ok) {
        const current = await response.json();
        if (epoch === loadEpoch.current && !edited.current) setProfile(current ?? { handle: "", name: "", title: "", biography: "", timezone: "", focusAreas: [], socialProof: [] });
        return;
      }
      const message = await errorMessage(response); if (epoch === loadEpoch.current) setError(message);
    } catch { if (epoch === loadEpoch.current) setError("The profile could not be loaded. Reload to try again."); }
  }, []);
  useEffect(() => { void load(); return () => { loadEpoch.current += 1; }; }, [load]);

  if (!profile) return <WorkspaceLoadState error={error} label="Loading profile…" onRetry={() => load()} />;

  function update<K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) {
    edited.current = true;
    setSaved(false);
    setProfile((current) => (current ? { ...current, [key]: value } : current));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!profile || !hydrated || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const response = await api.api.app.profile.$patch({ json: profile });
      if (response.ok) { setProfile(await response.json()); setSaved(true); }
      else setError(await errorMessage(response));
    } catch { setError("The save result could not be checked. Your profile details are kept here; retry to apply them."); }
    finally { inFlight.current = false; setSaving(false); }
  }

  return (
    <form className="grid gap-7" onSubmit={save}>
      <PageHeader eyebrow="Host configuration" title="Profile" description="This is the single host identity shown across your public scheduling pages." actions={<Button type="submit" disabled={!hydrated || saving}>{saving ? "Saving…" : "Save profile"}</Button>} />
      {error ? <p role="alert" className="rounded-[14px] bg-danger-wash p-3 text-sm leading-6 text-danger">{error}</p> : null}
      {saved ? <p role="status" className={noticeClassName("success")}>Profile saved.</p> : null}
      <fieldset disabled={!hydrated || saving} className="grid gap-6 border-0 p-0 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-6">
          <Card className="p-5 sm:p-6">
            <SectionHeading icon="user" title="Host details" description="Keep these public details clear and recognisable." />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input maxLength={120} value={profile.name} onChange={(event) => update("name", event.target.value)} required /></Field>
              <Field label="Title"><Input maxLength={180} value={profile.title} onChange={(event) => update("title", event.target.value)} required /></Field>
              <Field label="Public handle"><Input maxLength={80} value={profile.handle} onChange={(event) => update("handle", event.target.value.toLowerCase())} required /></Field>
              <TimezonePicker label="Host timezone" value={profile.timezone} onChange={(zone) => update("timezone", zone)} required />
              <Field label="Biography" className="sm:col-span-2"><Textarea maxLength={2000} value={profile.biography} onChange={(event) => update("biography", event.target.value)} required /></Field>
            </div>
          </Card>
          <Card className="p-5 sm:p-6">
            <SectionHeading icon="check" title="Focus areas" description="Use concise labels; up to six appear on the public profile." action={<Button variant="secondary" type="button" disabled={profile.focusAreas.length >= 6} onClick={() => update("focusAreas", [...profile.focusAreas, { label: "" }])}>Add focus area</Button>} />
            <div className="mt-5 grid gap-3">
              {profile.focusAreas.map((area, index) => <div key={index} className="flex gap-2"><Input aria-label={`Focus area ${index + 1}`} maxLength={40} value={area.label} onChange={(event) => update("focusAreas", profile.focusAreas.map((entry, position) => position === index ? { label: event.target.value } : entry))} required /><Button variant="quiet" type="button" aria-label={`Remove focus area ${index + 1}`} onClick={() => update("focusAreas", profile.focusAreas.filter((_, position) => position !== index))}>Remove</Button></div>)}
            </div>
          </Card>
          <Card className="p-5 sm:p-6">
            <SectionHeading icon="message" title="Operator-authored social proof" description="Quotes and attributions are typed by you; Dial never collects ratings or reviews." action={<Button variant="secondary" type="button" disabled={profile.socialProof.length >= 3} onClick={() => update("socialProof", [...profile.socialProof, { quote: "", attribution: "" }])}>Add quote</Button>} />
            <div className="mt-5 grid gap-4">
              {profile.socialProof.map((entry, index) => <div key={index} className="rounded-2xl bg-row p-4"><Field label="Quote"><Textarea maxLength={280} value={entry.quote} onChange={(event) => update("socialProof", profile.socialProof.map((item, position) => position === index ? { ...item, quote: event.target.value } : item))} required /></Field><div className="mt-3 flex gap-2"><div className="flex-1"><Field label="Attribution"><Input maxLength={120} value={entry.attribution} onChange={(event) => update("socialProof", profile.socialProof.map((item, position) => position === index ? { ...item, attribution: event.target.value } : item))} required /></Field></div><Button className="mt-6" variant="quiet" type="button" onClick={() => update("socialProof", profile.socialProof.filter((_, position) => position !== index))}>Remove</Button></div></div>)}
            </div>
          </Card>
        </div>
        <div className="grid content-start gap-5">
          <Card className="p-5 sm:p-6"><p className="text-xs font-bold uppercase tracking-[.12em] text-muted">Public profile preview</p><div className="mt-4 rounded-2xl bg-row p-5"><HostAvatar name={profile.name} avatarKey={"avatarKey" in profile ? profile.avatarKey : undefined} className="grid h-14 w-14 place-items-center rounded-full bg-gold-wash text-lg font-extrabold text-ink" /><h2 className="mt-4 text-[28px] font-extrabold leading-[1.1] tracking-[-.02em]">{profile.name}</h2><p className="mt-2 flex items-center gap-2 text-[15px] font-bold text-ink">{profile.title ? <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-gold" /> : null}{profile.title}</p><p className="mt-4 text-sm leading-6 text-soft">{profile.biography}</p>{profile.focusAreas.length ? <div className="mt-4 flex flex-wrap gap-2">{profile.focusAreas.map((area, index) => <span className="inline-flex h-[26px] items-center rounded-full bg-wash px-2.5 text-[13px] font-semibold text-ink" key={index}>{area.label}</span>)}</div> : null}{profile.socialProof.map((entry, index) => <blockquote className="mt-4 border-l-2 border-gold pl-3 text-sm italic leading-6 text-soft" key={`${entry.quote}-${index}`}>“{entry.quote}”<cite className="mt-1 block text-xs not-italic font-semibold">— {entry.attribution}</cite></blockquote>)}</div></Card>
          <AvatarEditor saved={"id" in profile} avatarKey={"avatarKey" in profile ? profile.avatarKey : undefined} disabled={!hydrated || saving} onSaved={(saved) => setProfile((current) => current ? { ...current, id: saved.id, avatarKey: saved.avatarKey, avatarContentType: saved.avatarContentType } : saved)} />
        </div>
      </fieldset>
    </form>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`grid content-start gap-2 text-sm font-[650] text-ink ${className}`}><span>{label}</span>{children}</label>;
}
