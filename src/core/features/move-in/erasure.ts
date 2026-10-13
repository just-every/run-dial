import { eraseD1ImportTarget } from '../../../../modules/import-kit/src/d1/index.ts';
import type { SessionRecord } from '../operators';
import { ErasureRepository } from '../erasure';
import { importContext } from './service';

/** Personal deletion and native cleanup commit with kit tombstones and undo custody. */
export async function eraseImportedBooking(db: D1Database, id: string, session: SessionRecord, secret: string) {
  const marker = await db.prepare("SELECT id FROM move_in_targets WHERE kind='booking' AND id=?").bind(id).first();
  if (!marker) return undefined;
  const context = { ...importContext(db, session), originalErasurePolicy: 'withdraw-all-job-artifacts' as const };
  return new ErasureRepository(db, secret).booking(id, session, async statements => {
    await eraseD1ImportTarget('booking', id, statements, context);
  });
}
