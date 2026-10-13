import type { ArchivePolicy } from '../base-cli/modules/portability/index.mjs';
export function exportPolicy(db: D1Database, vars: Record<string, unknown>, schemaProof: string): Promise<{policy: ArchivePolicy; knownSecrets: string[]}>;
