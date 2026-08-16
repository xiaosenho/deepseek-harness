/** Build-time Web-kernel pin record and upstream update check. */

import { readFileSync } from 'node:fs'

const UPSTREAM_REPO = 'deepseek-ai/deepseek-harness'
const DEFAULT_API_BASE = 'https://api.github.com'
const CHECK_TIMEOUT_MS = 10_000
const COMMIT_PATTERN = /^[0-9a-f]{40}$/

/** JSON-safe record written by scripts/gen-version-info.mjs at build time. */
export interface WebKernelInfo {
  /** Product name recorded by the shell build. */
  productName: string
  /** Installed shell version (electron/package.json). */
  version: string
  /** Pinned web-kernel commit SHA at build time. */
  webKernelCommit: string
  /** ISO build timestamp. */
  builtAt: string
}

/** User-visible outcome of one upstream Web-kernel check. */
export type WebKernelUpdateStatus =
  | { status: 'unknown' }
  | { status: 'checking' }
  | { status: 'current' }
  | { status: 'update-available'; latestCommit: string }
  | { status: 'failed'; detail: string }

type KernelFetch = (input: string, init?: RequestInit) => Promise<Response>

/** Read the build-time kernel record; null when the file is absent or invalid. */
export function readWebKernelInfo(versionJsonPath: string): WebKernelInfo | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(versionJsonPath, 'utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (
    typeof record.productName !== 'string' || typeof record.version !== 'string'
    || typeof record.webKernelCommit !== 'string' || typeof record.builtAt !== 'string'
  ) return null
  return {
    productName: record.productName,
    version: record.version,
    webKernelCommit: record.webKernelCommit,
    builtAt: record.builtAt,
  }
}

/**
 * Compare the pinned kernel commit against upstream master; failures are reported, not thrown.
 * @param kernelCommit - pinned commit recorded at build time.
 * @param fetch - HTTP implementation supplied by Electron main.
 * @param baseUrl - GitHub API origin override for tests.
 * @returns the comparison outcome.
 */
export async function checkWebKernelUpdate(
  kernelCommit: string,
  fetch: KernelFetch,
  baseUrl = DEFAULT_API_BASE,
): Promise<WebKernelUpdateStatus> {
  if (!COMMIT_PATTERN.test(kernelCommit)) return { status: 'unknown' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}/repos/${UPSTREAM_REPO}/commits/master`, {
      headers: { accept: 'application/vnd.github.sha' },
      signal: controller.signal,
    })
    if (!response.ok) return { status: 'failed', detail: `upstream check returned ${response.status}` }
    const latest = (await response.text()).trim()
    if (!COMMIT_PATTERN.test(latest)) return { status: 'failed', detail: 'upstream check returned an invalid commit' }
    return latest === kernelCommit
      ? { status: 'current' }
      : { status: 'update-available', latestCommit: latest }
  } catch (error) {
    return { status: 'failed', detail: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}
