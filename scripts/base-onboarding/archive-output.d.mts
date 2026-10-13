import type { Plugin } from 'vite';
/** `formats`: the seed's own archive formats, matched against a leading JSON object's `payload.format`. */
export interface ArchiveFormats { formats?: string[] }
export function assertArchiveFree(directory: string, options?: ArchiveFormats): Promise<void>;
export function archiveOutputGuard(options?: ArchiveFormats): Plugin;
