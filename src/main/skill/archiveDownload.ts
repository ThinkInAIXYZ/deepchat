import { open, unlink, type FileHandle } from 'node:fs/promises'

const DEFAULT_MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const ZIP_MEDIA_TYPES = new Set([
  'application/octet-stream',
  'application/x-zip',
  'application/x-zip-compressed',
  'application/zip'
])

export type SkillArchiveDownloadOptions = Readonly<{
  maxBytes: number
  timeoutMs: number
  maxRedirects?: number
  fetchImpl?: typeof fetch
}>

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be positive`)
  return value
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be nonnegative`)
  return value
}

function parseHttpUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Skill archive URL is invalid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Skill archive URL must use HTTP or HTTPS')
  }
  if (url.username || url.password) {
    throw new Error('Skill archive URL must not contain credentials')
  }
  return url
}

async function removePartialFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function writeAll(handle: FileHandle, bytes: Buffer, position: number): Promise<number> {
  let offset = 0
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.length - offset,
      position + offset
    )
    if (bytesWritten === 0) throw new Error('Failed to persist Skill archive download')
    offset += bytesWritten
  }
  return position + bytes.length
}

function declaredContentLength(response: Response, maxBytes: number): number | null {
  const raw = response.headers.get('content-length')
  if (raw === null) return null
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) {
    throw new Error('Skill archive Content-Length is invalid')
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) {
    throw new Error('Skill archive Content-Length is too large')
  }
  if (value > maxBytes) {
    throw new Error(`Skill archive exceeds the ${maxBytes}-byte download limit`)
  }
  return value
}

function assertZipMediaType(response: Response): void {
  const raw = response.headers.get('content-type')
  if (!raw) return
  const mediaType = raw.split(';', 1)[0].trim().toLowerCase()
  if (!ZIP_MEDIA_TYPES.has(mediaType)) {
    throw new Error('Skill archive response is not a ZIP payload')
  }
}

async function fetchWithSafeRedirects(
  initialUrl: URL,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  maxRedirects: number
): Promise<Response> {
  let currentUrl = initialUrl
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, { redirect: 'manual', signal })
    if (!REDIRECT_STATUSES.has(response.status)) return response
    if (redirectCount >= maxRedirects) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('Skill archive download exceeded the redirect limit')
    }
    const location = response.headers.get('location')
    if (!location) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('Skill archive redirect has no destination')
    }
    const nextUrl = parseHttpUrl(new URL(location, currentUrl).toString())
    if (currentUrl.protocol === 'https:' && nextUrl.protocol !== 'https:') {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('Skill archive download refused an HTTPS downgrade')
    }
    await response.body?.cancel().catch(() => undefined)
    currentUrl = nextUrl
  }
}

export async function downloadSkillArchive(
  url: string,
  destinationPath: string,
  options: SkillArchiveDownloadOptions
): Promise<void> {
  const maxBytes = positiveInteger(options.maxBytes, 'maxBytes')
  const timeoutMs = positiveInteger(options.timeoutMs, 'timeoutMs')
  const maxRedirects = nonnegativeInteger(
    options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    'maxRedirects'
  )
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  timeout.unref()
  let handle: FileHandle | undefined
  let completed = false
  let response: Response | undefined

  try {
    response = await fetchWithSafeRedirects(
      parseHttpUrl(url),
      fetchImpl,
      controller.signal,
      maxRedirects
    )
    if (!response.ok) {
      throw new Error(`Skill archive download failed with HTTP ${response.status}`)
    }
    assertZipMediaType(response)
    const expectedBytes = declaredContentLength(response, maxBytes)
    if (!response.body) throw new Error('Skill archive response has no body')

    handle = await open(destinationPath, 'wx', 0o600)
    let size = 0
    let position = 0
    for await (const rawChunk of response.body) {
      const chunk = Buffer.from(rawChunk)
      size += chunk.length
      if (size > maxBytes) {
        throw new Error(`Skill archive exceeds the ${maxBytes}-byte download limit`)
      }
      position = await writeAll(handle, chunk, position)
    }
    if (size === 0) throw new Error('Skill archive download is empty')
    const contentEncoding = response.headers.get('content-encoding')?.trim().toLowerCase()
    if (
      expectedBytes !== null &&
      (!contentEncoding || contentEncoding === 'identity') &&
      size !== expectedBytes
    ) {
      throw new Error('Skill archive body length does not match Content-Length')
    }
    await handle.close()
    handle = undefined
    completed = true
  } finally {
    clearTimeout(timeout)
    await handle?.close().catch(() => undefined)
    if (!completed) await response?.body?.cancel().catch(() => undefined)
    if (!completed) await removePartialFile(destinationPath)
  }
}
