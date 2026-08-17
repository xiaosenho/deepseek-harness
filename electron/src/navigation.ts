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
 * Create a navigation check that reads the active Web-profile origin for every event.
 * @param resolveApplicationUrl - current URL getter.
 * @returns a predicate that follows the current backend origin.
 */
export function createApplicationNavigationGuard(
  resolveApplicationUrl: () => URL | undefined,
): (target: string) => boolean {
  return (target) => {
    const applicationUrl = resolveApplicationUrl()
    return applicationUrl !== undefined && isApplicationNavigation(target, applicationUrl)
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
