import type { Plugin } from 'vite';
export function assertArchiveFree(directory: string): Promise<void>;
export function archiveOutputGuard(): Plugin;
