import { open } from 'node:fs/promises';
import { join } from 'node:path';
// entrypoint.sh holds a kernel flock on this inode for the entire process lifetime.
// It works across container PID namespaces and releases automatically on SIGKILL.
// Never unlink the lock inode: a new inode would permit a second live holder.
export async function recordVolumeOwner(directory) {
 const file = await open(join(directory, 'host.lock'), 'r+', 0o600);
 const write = async () => { const bytes = Buffer.from(JSON.stringify({ pid: process.pid, heartbeat: new Date().toISOString() })); await file.truncate(0); await file.write(bytes, 0, bytes.length, 0); await file.sync(); };
 await write(); const timer = setInterval(() => void write().catch(() => { process.exitCode = 1; }), 10000); timer.unref();
 return async () => { clearInterval(timer); await file.close(); };
}
