/** Local capabilities require an explicitly configured, exact loopback origin. */
export function localDevelopmentEnabled(env) {
  if (env.AUTH_LOCAL !== 'true' || typeof env.AUTH_ORIGIN !== 'string') return false
  try {
    const url = new URL(env.AUTH_ORIGIN)
    return url.origin === env.AUTH_ORIGIN && !url.username && !url.password &&
      ['http:', 'https:'].includes(url.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  } catch { return false }
}
