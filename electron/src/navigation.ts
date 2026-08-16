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
 * @param resolveApplicationUrl - current URL getter updated before a restarted backend is loaded.
 * @returns a predicate that follows later backend origins instead of capturing the initial one.
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
 * Adopt and load a restarted WebUI origin, terminating through the supplied reporter if loading fails.
 * @param url - new loopback URL returned by the ready backend.
 * @param updateApplicationUrl - updates navigation authorization before loading.
 * @param loadUrl - active BrowserWindow loader, absent when no window is open.
 * @param reportFatalFailure - handles an origin whose renderer cannot be loaded safely.
 * @returns after the load succeeds or its fatal failure has been reported.
 */
export async function loadRestartedApplication(
  url: URL,
  updateApplicationUrl: (url: URL) => void,
  loadUrl: ((url: string) => Promise<unknown>) | undefined,
  reportFatalFailure: (error: Error) => void,
): Promise<void> {
  updateApplicationUrl(url)
  if (loadUrl === undefined) return
  try {
    await loadUrl(url.href)
  } catch (error) {
    reportFatalFailure(new Error(
      `The WebUI restarted at ${url.origin}, but the desktop window could not load it: ${errorMessage(error)}`,
    ))
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
