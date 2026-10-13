const meetPollDelaysMs = [15_000, 30_000, 60_000, 3 * 60_000, 5 * 60_000];

export function pendingMeetFollowUp(payloadJson: string, bookingId: string, occurrenceId: string, now: Date) {
  const payload = parseObject(payloadJson);
  if (!payload) return undefined;
  const completedPolls = typeof payload.conferencePollAttempt === "number" && Number.isInteger(payload.conferencePollAttempt) && payload.conferencePollAttempt >= 0
    ? payload.conferencePollAttempt
    : 0;
  const delay = meetPollDelaysMs[completedPolls];
  if (delay === undefined) return undefined;
  const nextAttempt = completedPolls + 1;
  const cycle = typeof payload.conferencePollCycle === "string" ? `:cycle:${payload.conferencePollCycle}` : "";
  return {
    idempotencyKey: `booking:${bookingId}:occurrence:${occurrenceId}:conference-poll${cycle}:${nextAttempt}`,
    payloadJson: JSON.stringify({ ...payload, conferencePollAttempt: nextAttempt }),
    nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
  };
}

function parseObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}
