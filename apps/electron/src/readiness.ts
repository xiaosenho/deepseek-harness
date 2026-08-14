/** Readiness parsing for the background `dsh web` command. */

const READY_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+\/?$)/

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

/** Return the strict loopback URL carried by a Web-profile readiness line. */
export function parseReadyUrl(line: string): URL | undefined {
  const match = READY_LINE.exec(line.trim())
  return match?.[1] === undefined ? undefined : new URL(match[1])
}
