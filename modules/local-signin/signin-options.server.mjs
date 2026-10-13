import { localDevelopmentEnabled } from './local.server.mjs'

/** Public presentation only; authentication and outbox access enforce their own guards. */
export function signinPresentation(bindings) {
  const local = localDevelopmentEnabled(bindings)
  return {
    local,
    developmentOutbox: bindings.MAIL_PROVIDER === 'development' && local,
    setupInstructions: local
      ? 'Open .dev.vars in your local project and copy the SETUP_TOKEN value. This signs in the configured owner without sending email.'
      : 'Use the setup token from your deployment. This signs in the configured owner without sending email.',
  }
}
