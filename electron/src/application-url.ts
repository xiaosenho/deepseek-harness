/** Resolve the external URL used by the managed desktop window. */
export function resolveApplicationUrl(configured: string): URL {
  const url = new URL(configured.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`DSH_ELECTRON_URL must use HTTP or HTTPS, got ${url.protocol}`)
  }
  return url
}
