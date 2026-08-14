/** Token-bearing remote-access URL creation for the Electron host. */

/**
 * Add the per-launch remote-access token to a LAN WebUI URL.
 * @param lanUrl - LAN URL announced by the ready Web profile.
 * @param accessToken - token required by non-loopback API requests.
 * @returns a detached URL carrying the token in its fragment.
 */
export function formatRemoteAccessUrl(lanUrl: URL, accessToken: string): URL {
  const url = new URL(lanUrl)
  url.hash = new URLSearchParams({ 'dsh-access': accessToken }).toString()
  return url
}
