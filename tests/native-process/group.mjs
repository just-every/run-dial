import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

// Each owned child is a new session/group leader. Never signal a process name,
// port occupant, parent group, or a descendant's possibly reused individual PID.
export async function liveGroupMembers(pid) {
  if (!pid) return [];
  const { stdout } = await execute("ps", ["-Ao", "pid=,pgid=,stat="], { timeout: 1000 });
  return stdout.split("\n").flatMap((line) => {
    const [member, group, state] = line.trim().split(/\s+/);
    // Dead orphan zombies cannot hold pipes or execute; their reaping belongs
    // to the OS parent, and SIGKILL cannot remove them.
    return Number(group) === pid && !state?.startsWith("Z") ? [Number(member)] : [];
  });
}

// macOS answers EPERM, not ESRCH, when a group's only remaining members are exited zombies still waiting to be reaped (as
// they are on a loaded machine just after `rer dev --stop`). Nothing live is left to signal, so that is a stopped group;
// EPERM with a live member is a real refusal and stays an error.
function liveMembersNow(pid) {
  return execFileSync("ps", ["-Ao", "pid=,pgid=,stat="], { encoding: "utf8", timeout: 1000 }).split("\n").filter((line) => {
    const [, group, state] = line.trim().split(/\s+/);
    return Number(group) === pid && !state?.startsWith("Z");
  }).length;
}

// Without a trustworthy process listing an EPERM stays the refusal it reports.
function settledGroup(pid) {
  try { return liveMembersNow(pid) === 0; } catch { return false; }
}

export function signalOwnedGroup(pid, signal) {
  if (!pid) return;
  try { process.kill(-pid, signal); }
  catch (error) {
    if (error.code === "ESRCH" || (error.code === "EPERM" && settledGroup(pid))) return;
    throw error;
  }
}
