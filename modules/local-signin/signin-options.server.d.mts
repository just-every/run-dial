import type { Bindings } from '../bindings.server'

export function signinPresentation(bindings: Pick<Bindings, 'AUTH_LOCAL' | 'AUTH_ORIGIN' | 'MAIL_PROVIDER'>): {
  local: boolean;
  developmentOutbox: boolean;
  setupInstructions: string;
};
