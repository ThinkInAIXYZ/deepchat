import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { classifyDownloadError, ToolchainDownloadError } from './errors'

export type DownloadProgress = {
  receivedBytes: number
  totalBytes: number | null
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const successfulProbeCache = new Map<string, string>()

export function resetProbeCacheForTests(): void {
  successfulProbeCache.clear()
}

export async function probeArtifactUrl(
  url: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow',
      signal
    })
    if (response.status === 200 || response.status === 206) {
      successfulProbeCache.set(url, url)
      return true
    }
    return false
  } catch {
    return false
  }
}

export function resolveDownloadUrl(officialUrl: string, mirrorUrl?: string): string {
  if (mirrorUrl && successfulProbeCache.has(mirrorUrl)) return mirrorUrl
  if (successfulProbeCache.has(officialUrl)) return officialUrl
  return officialUrl
}

export async function selectDownloadUrl(
  officialUrl: string,
  fetchImpl: FetchLike,
  options?: { mirrorUrl?: string; signal?: AbortSignal; allowProbe?: boolean }
): Promise<string> {
  const mirrorUrl = options?.mirrorUrl
  if (!options?.allowProbe) return officialUrl

  const candidates = [mirrorUrl, officialUrl].filter((url): url is string => Boolean(url))
  const results = await Promise.all(
    candidates.map(async (url) => ({
      url,
      ok: await probeArtifactUrl(url, fetchImpl, options.signal)
    }))
  )
  const success = results.find((result) => result.ok)
  return success?.url ?? officialUrl
}

export async function downloadVerifiedFile(options: {
  url: string
  destPath: string
  sha256: string
  fetch?: FetchLike
  signal?: AbortSignal
  onProgress?: (progress: DownloadProgress) => void
}): Promise<void> {
  const fetchImpl = options.fetch ?? fetch
  mkdirSync(path.dirname(options.destPath), { recursive: true })
  const destPath = options.destPath
  const partialPath = `${destPath}.partial`

  if (existingSize(destPath) > 0) {
    const actual = await sha256File(destPath)
    if (actual === options.sha256) return
    rmSync(destPath, { force: true })
  }

  let existing = existingSize(partialPath)
  let response = await requestDownload(fetchImpl, options.url, existing, options.signal)

  if (response.status === 416) {
    rmSync(partialPath, { force: true })
    existing = 0
    response = await requestDownload(fetchImpl, options.url, 0, options.signal)
  }

  if (response.status !== 200 && response.status !== 206) {
    throw new ToolchainDownloadError(
      'http',
      `Toolchain download failed with HTTP ${response.status}`
    )
  }

  const restart = response.status === 200
  if (restart) {
    rmSync(partialPath, { force: true })
    existing = 0
  }
  const append = response.status === 206 && existing > 0
  const receivedStart = append ? existing : 0
  const totalBytes = readTotalBytes(response, receivedStart)

  if (!response.body) {
    throw new ToolchainDownloadError('http', 'Toolchain download returned an empty body')
  }

  let receivedBytes = receivedStart
  options.onProgress?.({ receivedBytes, totalBytes })

  const file = createWriteStream(partialPath, { flags: append ? 'a' : 'w' })
  const reader = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
  reader.on('data', (chunk: Buffer) => {
    receivedBytes += chunk.length
    options.onProgress?.({ receivedBytes, totalBytes })
  })

  try {
    await pipeline(reader, file)
  } catch (error) {
    throw classifyDownloadError(error)
  }

  const actual = await sha256File(partialPath)
  if (actual !== options.sha256) {
    rmSync(partialPath, { force: true })
    throw new ToolchainDownloadError(
      'checksum_mismatch',
      'Downloaded toolchain archive failed sha256 verification'
    )
  }

  rmSync(destPath, { force: true })
  renameSync(partialPath, destPath)
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolve())
  })
  return hash.digest('hex')
}

async function requestDownload(
  fetchImpl: FetchLike,
  url: string,
  existing: number,
  signal?: AbortSignal
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (existing > 0) headers.Range = `bytes=${existing}-`
  try {
    return await fetchImpl(url, {
      headers,
      redirect: 'follow',
      signal
    })
  } catch (error) {
    throw classifyDownloadError(error)
  }
}

function existingSize(filePath: string): number {
  try {
    const stats = statSync(filePath)
    return stats.isFile() ? stats.size : 0
  } catch {
    return 0
  }
}

function readTotalBytes(response: Response, receivedStart: number): number | null {
  if (response.status === 206) {
    const match = /\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
    if (match) return Number(match[1])
  }
  const length = response.headers.get('content-length')
  if (!length) return null
  const parsed = Number(length)
  if (!Number.isFinite(parsed)) return null
  return receivedStart + parsed
}
