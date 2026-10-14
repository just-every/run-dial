import type { ArchivePolicy } from '@runeditrun/rer/modules/portability';
export function exportPolicy(db: D1Database, vars: Record<string, unknown>, schemaProof: string): Promise<{policy: ArchivePolicy; knownSecrets: string[]}>;
