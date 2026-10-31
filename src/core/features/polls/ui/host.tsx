import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { operatorTimestamp, operatorTimeRange } from "../../../shared/operator-format";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "../../../app/ui/page-header";
import { buttonClassName, noticeClassName, PlainLink } from "../../../app/ui/primitives";
import { IndexHead, PageOnly, RecordBack, RecordLayout, RecordRow, RecordRows, countOf, recordTrail, useReturnFocus } from "../../../app/ui/record-layout";
import { recordId } from "../../../app/record-id";
import { useRecordRead } from "../../../app/use-record-read";
import { useWorkspaceRead } from "../../../app/workspace-reads";
import { useHydrated } from "../../../app/use-hydrated";
import { RecordNotFound } from "../../bookings/client";
import type { Poll, PollView } from "../types";
import { usePollRead, pollMutation } from "./read";
import { PollComposer } from "./composer";

const list = "/app/polls";

/** Meeting polls at /app/polls with the composer, and a poll at its own path /app/polls/<id> (POLL-001, DW6). */
export function PollsPage() {
  const navigate = useNavigate();
  const selected = useRouterState({ select: state => (state.matches.at(-1)?.params as { id?: string } | undefined)?.id });
  const [revision, setRevision] = useState(0), [notice, setNotice] = useState("");
  const polls = usePollRead<Poll[]>("/api/app/polls", revision), profile = useWorkspaceRead<{ timezone: string }>("/api/app/profile");
  const poll = useRecordRead<PollView>(recordId(selected) && `/api/app/polls/${selected}`, revision);
  const refresh = () => setRevision(value => value + 1);
  const open = Boolean(selected);
  useReturnFocus(list, open);
  if (selected && (!recordId(selected) || poll.missing)) return <RecordNotFound kind="poll" back="/app/polls" />;
  const noticeLine = notice ? <p role="status" className={noticeClassName("success")}>{notice}</p> : null;
  const record = open ? <div className="grid min-w-0 gap-5">
    <RecordBack href={list} label="Meeting polls" className="xl:hidden" />
    {noticeLine}
    <HostPoll key={selected} poll={poll.data} error={poll.error} zone={profile?.timezone ?? "UTC"} onChanged={refresh} />
  </div> : undefined;
  return <RecordLayout record={record}>
    <div className="grid min-w-0 gap-7" data-polls-ready={Boolean(polls.data)}>
      <PageOnly>
        <PageHeader title="Meeting polls" description="Find a time together without sharing participants’ identities." actions={<PlainLink to="/app/bookings" search={() => ({})} className={buttonClassName("secondary")}>Bookings</PlainLink>} />
        {profile && !open ? <p className="text-sm text-muted">Times in {profile.timezone}</p> : null}
        {noticeLine}
      </PageOnly>
      <IndexHead back={<RecordBack href={list} label="Meeting polls" />} meta={polls.data ? countOf(polls.data.length, "poll") : undefined} />
      {!polls.data ? <WorkspaceLoadState error={polls.error} label="Loading polls…" onRetry={refresh} /> : null}
      <PageOnly><PollComposer onCreated={id => { refresh(); setNotice("Poll created and participant invitations queued."); void navigate({ to: "/app/polls/$id", params: { id }, state: recordTrail(list) }); }} /></PageOnly>
      {polls.data?.length ? <RecordRows className="min-w-0">
        {polls.data.map(item => <RecordRow key={item.id} to="/app/polls/$id" params={{ id: item.id }} state={recordTrail(list)} row={item.id} list={list} current={item.id === selected} className="break-words">
          <strong>{item.title}</strong>{item.state === "closed" || item.closesAt < new Date().toISOString() ? <span className="block text-sm text-muted">Closed</span> : null}
        </RecordRow>)}
      </RecordRows> : null}
    </div>
  </RecordLayout>;
}

/** A poll as its own page: its title the page's one title, the counts in sunk tiles, closing it the one ink pill. */
function HostPoll({ poll, error, zone, onChanged }: { poll?: PollView; error?: string; zone: string; onChanged: () => void }) {
  const [failure, setFailure] = useState(""), [tally, setTally] = useState<boolean>(), [busy, setBusy] = useState(false);
  const hydrated = useHydrated();
  async function mutate(action: string, data?: unknown) {
    if (!poll) return false;
    setBusy(true);
    try { await pollMutation(`/api/app/polls/${poll.id}/${action}`, data); onChanged(); return true; }
    catch (e) { setFailure(e instanceof Error ? e.message : "The poll could not be updated."); return false; }
    finally { setBusy(false); }
  }
  const count = (candidate: string, choice: "yes" | "if_needed" | "no") => poll?.participants.filter(p => p.votes.some(v => v.candidateId === candidate && v.choice === choice)).length;
  return <article className="grid min-w-0 gap-5" data-poll-detail-ready={Boolean(poll)}>
    {failure ? <p role="alert">{failure}</p> : null}
    {poll ? <>
      <div className="min-w-0 break-words"><h1 className="text-[34px] font-extrabold leading-[1.05] tracking-[-.02em] text-ink sm:text-[40px]">{poll.title}</h1><p className="mt-3 text-[15px] text-soft">Closes {operatorTimestamp(poll.closesAt, zone)}.</p><p className="mt-1 text-sm text-muted">Times in {zone}</p></div>
      <div><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={tally ?? Boolean(poll.showTally)} disabled={!hydrated || busy} onChange={e => { const show = e.target.checked; setTally(show); void mutate("tally", { show }).then(saved => { if (!saved) setTally(undefined); }); }} />Show counts to participants</label><p className="text-sm text-muted">Participants see their own votes. Names and email addresses stay private.</p></div>
      {poll.candidates.map(candidate => <section key={candidate.id} className="rounded-2xl bg-row px-4 py-3.5"><h2 className="font-semibold">{operatorTimeRange(candidate.startAt, candidate.endAt, zone)}</h2><p className="mt-1 text-sm text-soft">{count(candidate.id, "yes")} yes · {count(candidate.id, "if_needed")} if needed · {count(candidate.id, "no")} no</p></section>)}
      <h2 className="mt-2 font-bold">Participants</h2>
      <ul className="-mt-2 grid gap-2">{poll.participants.map(person => <li key={person.id} className="break-words">{person.name} · <span className="break-all">{person.email}</span> · {person.votes.length ? "Responded" : "Waiting"}</li>)}</ul>
      {poll.state === "open" ? <button type="button" className={buttonClassName("primary", "justify-self-start")} disabled={!hydrated || busy} onClick={() => void mutate("close")}>Close poll and release times</button> : <p role="status">This poll is closed. Its held times have been released.</p>}
    </> : <WorkspaceLoadState error={error} label="Loading poll…" onRetry={onChanged} />}
  </article>;
}
