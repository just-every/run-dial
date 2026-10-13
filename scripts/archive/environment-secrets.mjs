// Credential names only: public emails, origins, IDs and paths are not secrets.
const credentialName = /(?:^|_)(?:SECRET|TOKEN|API_KEY|WEBHOOK_KEY|DEV_KEY|PRIVATE_KEY|SECRET_ACCESS_KEY)$/;
export function environmentSecrets(...sources) {
  return [...new Set(sources.flatMap(source => Object.entries(source ?? {}).filter(([key, value]) => credentialName.test(key) && typeof value === 'string' && value.length > 0).map(([, value]) => value)))];
}
