/** Readiness parsing for the background `dsh web` command. */

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)'
const READY_LINE = new RegExp(
  '^dsh web: (?<loopback>http://127\\.0\\.0\\.1:(?<port>[1-9]\\d{0,4})/?)'
  + `(?: \\(LAN: (?<lan>http://(?:${IPV4_OCTET}\\.){3}${IPV4_OCTET}:(?<lanPort>[1-9]\\d{0,4})/?)\\))?$`,
)

/** URLs announced when the background Web profile is ready. */
export interface ReadyUrls {
  /** Loopback URL loaded by the Electron renderer. */
  loopbackUrl: URL
  /** First reachable LAN URL, when the host has an external IPv4 address. */
  lanUrl?: URL
}

/** Incrementally splits process output without losing a partial final line. */
export class LineBuffer {
  private pending = ''

  /** Append output and return every newly completed line. */
  push(chunk: string): string[] {
    const parts = `${this.pending}${chunk}`.split(/\r?\n/)
    this.pending = parts.pop() ?? ''
    return parts
  }
}

/**
 * Return the strict loopback and optional same-port IPv4 LAN readiness URLs.
 * @param line - one complete stdout line from the Web profile.
 * @returns parsed URLs, or undefined when the line is not the readiness form.
 */
export function parseReadyUrls(line: string): ReadyUrls | undefined {
  const match = READY_LINE.exec(line.trim())
  const { loopback, port, lan, lanPort } = match?.groups ?? {}
  if (loopback === undefined || port === undefined || Number(port) > 65_535) return undefined
  if (lan !== undefined && lanPort !== port) return undefined
  const lanUrl = lan === undefined ? undefined : new URL(lan)
  if (lanUrl?.hostname === '0.0.0.0' || lanUrl?.hostname.startsWith('127.') === true) return undefined
  return {
    loopbackUrl: new URL(loopback),
    ...lanUrl === undefined ? {} : { lanUrl },
  }
}
