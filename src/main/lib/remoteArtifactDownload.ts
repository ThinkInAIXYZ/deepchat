import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { downloadVerifiedFile, probeArtifactUrl, type FetchLike } from '@/toolchains/downloader'

const DEFAULT_PROBE_TIMEOUT_MS = 4_000

/**
 * A remotely distributed artifact pinned by the distribution catalog. Mirrors
 * are ghproxy-style prefixes concatenated with the canonical URL; the pinned
 * sha256 makes any mirror bit-for-bit verifiable.
 */
export interface RemoteArtifactDescriptor {
  url: string
  sha256: string
  size: number
  mirrors: string[]
}

export type DownloadPhase = 'probing' | 'downloading'

export interface RemoteArtifactDownloadProgress {
  phase: DownloadPhase
  receivedBytes: number
  totalBytes: number | null
}

export type StagedArtifact = {
  operationId: string
  stagingDir: string
  archivePath: string
}

export function buildArtifactCandidateUrls(descriptor: RemoteArtifactDescriptor): string[] {
  const candidates = [
    descriptor.url,
    ...descriptor.mirrors.map((mirror) => `${mirror}${descriptor.url}`)
  ]
  return Array.from(new Set(candidates))
}

/**
 * Probes every candidate in parallel with a short timeout and picks the
 * fastest successful one (declared order breaks ties). If no candidate
 * answers, the canonical URL is still attempted — a failed probe is not a
 * guarantee that the download would fail.
 */
export async function selectArtifactUrl(
  descriptor: RemoteArtifactDescriptor,
  options: {
    fetchImpl?: FetchLike
    signal?: AbortSignal
    probeTimeoutMs?: number
    now?: () => number
  } = {}
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch
  const candidates = buildArtifactCandidateUrls(descriptor)
  const timeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const now = options.now ?? Date.now
  const results = await Promise.all(
    candidates.map(async (url, index) => {
      const probeSignal = options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs)
      const started = now()
      const ok = await probeArtifactUrl(url, fetchImpl, probeSignal)
      return { url, index, ok, elapsedMs: now() - started }
    })
  )
  const success = results
    .filter((result) => result.ok && !options.signal?.aborted)
    .sort((left, right) => left.elapsedMs - right.elapsedMs || left.index - right.index)[0]
  return success?.url ?? candidates[0]
}

/**
 * Downloads an artifact into a fresh staging directory and verifies it against
 * the catalog-pinned sha256 before returning the archive path. The staging
 * directory is owned by the caller and must be cleaned up after use.
 */
export async function downloadArtifactToStaging(options: {
  descriptor: RemoteArtifactDescriptor
  stagingRoot: string
  fetchImpl?: FetchLike
  signal?: AbortSignal
  probeTimeoutMs?: number
  now?: () => number
  onProgress?: (progress: RemoteArtifactDownloadProgress) => void
}): Promise<StagedArtifact> {
  const operationId = randomUUID()
  const stagingDir = path.join(options.stagingRoot, operationId)
  const archivePath = path.join(stagingDir, 'artifact.zip')
  rmSync(stagingDir, { recursive: true, force: true })
  mkdirSync(stagingDir, { recursive: true })

  try {
    options.onProgress?.({
      phase: 'probing',
      receivedBytes: 0,
      totalBytes: options.descriptor.size
    })
    const selectedUrl = await selectArtifactUrl(options.descriptor, {
      fetchImpl: options.fetchImpl,
      signal: options.signal,
      probeTimeoutMs: options.probeTimeoutMs,
      now: options.now
    })
    if (options.signal?.aborted) {
      throw new Error('Download cancelled')
    }

    options.onProgress?.({
      phase: 'downloading',
      receivedBytes: 0,
      totalBytes: options.descriptor.size
    })
    await downloadVerifiedFile({
      url: selectedUrl,
      destPath: archivePath,
      sha256: options.descriptor.sha256,
      fetch: options.fetchImpl,
      signal: options.signal,
      onProgress: (progress) => {
        options.onProgress?.({
          phase: 'downloading',
          receivedBytes: progress.receivedBytes,
          totalBytes: progress.totalBytes
        })
      }
    })

    return { operationId, stagingDir, archivePath }
  } catch (error) {
    // A failed download (including checksum mismatch) leaves nothing behind.
    rmSync(stagingDir, { recursive: true, force: true })
    throw error
  }
}
