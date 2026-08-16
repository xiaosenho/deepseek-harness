/** WebUI location selection for the Electron window. */

/**
 * Validate a WebUI URL configured for the desktop window.
 * @param configured - `DSH_ELECTRON_URL` value.
 * @returns a normalized HTTP or HTTPS URL.
 */
export function resolveApplicationUrl(configured: string): URL {
  const url = new URL(configured.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('DSH_ELECTRON_URL must use http:// or https://')
  }
  return url
}
