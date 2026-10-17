export type PostBookingRedirect = { url: string; fields: string[] };
export const redirectFields: readonly string[];
export function redirectUrlIssue(value: unknown): string | null;
export function redirectConfigIssue(value: unknown, questions?: readonly { key?: string; private?: boolean }[]): { path: (string | number)[]; message: string } | null;
