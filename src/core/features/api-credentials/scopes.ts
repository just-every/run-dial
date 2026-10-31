export const credentialScopes = ["bookings:read", "bookings:write", "event-types:manage", "routing:manage", "reports:read", "webhooks:manage", "workflows:manage"] as const;
export type CredentialScope = typeof credentialScopes[number];
