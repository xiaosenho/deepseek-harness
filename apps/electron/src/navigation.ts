/**
 * Whether a renderer navigation stays on the one loopback Web-profile origin.
 * @param target - requested navigation URL.
 * @param applicationUrl - canonical Web-profile URL.
 * @returns whether Electron may perform the navigation in the app window.
 */
export function isApplicationNavigation(target: string, applicationUrl: URL): boolean {
  try {
    return new URL(target).origin === applicationUrl.origin
  } catch {
    return false
  }
}

/**
 * Whether a denied app-window navigation may be handed to the operating system.
 * @param target - requested navigation URL.
 * @returns whether the URL uses HTTP or HTTPS.
 */
export function isExternalNavigation(target: string): boolean {
  try {
    const protocol = new URL(target).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
