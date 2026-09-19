import { lstat, open } from 'node:fs/promises'
import path from 'node:path'
import { ArtifactMetadataSchema } from '@shared/contracts/routes/artifacts.routes'
import { CliRequestError } from './errors'

const MAX_GENERATED_MEDIA_BYTES = 512 * 1024 * 1024
const MAX_ENCODED_MEDIA_CHARACTERS = Math.ceil(MAX_GENERATED_MEDIA_BYTES / 3) * 4
const BASE64_CHUNK_CHARACTERS = 1024 * 1024
const MAX_DATA_URL_HEADER_CHARACTERS = 512
const BASE64_ALPHABET_PATTERN = /^[A-Za-z0-9+/]+$/
const CACHE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/
const WINDOWS_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export type GeneratedMediaKind = 'image' | 'video' | 'audio'

export type ResolvedGeneratedMedia = Readonly<{
  mimeType: string
  data: AsyncIterable<Uint8Array>
  expectedBytes: number
  dispose?: () => Promise<void>
}>

function normalizeMimeType(value: string, kind: GeneratedMediaKind): string {
  const mimeType = ArtifactMetadataSchema.shape.mimeType.parse(value.trim().toLowerCase())
  if (!mimeType.startsWith(`${kind}/`)) {
    throw new CliRequestError('unavailable', `Provider returned invalid ${kind} output`, {
      httpStatus: 503,
      retriable: true
    })
  }
  return mimeType
}

function decodeUriPath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new CliRequestError('unavailable', 'Provider returned an invalid cached media path', {
      httpStatus: 503
    })
  }
}

function decodedBase64Length(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

function malformedMediaData(): CliRequestError {
  return new CliRequestError('unavailable', 'Provider returned malformed media data', {
    httpStatus: 503
  })
}

async function* decodeBase64(value: string): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < value.length; offset += BASE64_CHUNK_CHARACTERS) {
    const end = Math.min(value.length, offset + BASE64_CHUNK_CHARACTERS)
    const chunk = value.slice(offset, end)
    const isFinalChunk = end === value.length
    const padding = isFinalChunk ? (chunk.endsWith('==') ? 2 : chunk.endsWith('=') ? 1 : 0) : 0
    const alphabet = padding > 0 ? chunk.slice(0, -padding) : chunk
    if (!alphabet || !BASE64_ALPHABET_PATTERN.test(alphabet)) throw malformedMediaData()
    yield Buffer.from(chunk, 'base64')
  }
}

function resolveBase64(
  rawValue: string,
  claimedMimeType: string,
  kind: GeneratedMediaKind
): ResolvedGeneratedMedia {
  let encoded = rawValue.trim()
  let mimeType = claimedMimeType
  if (encoded.startsWith('data:')) {
    const header = encoded.slice(0, MAX_DATA_URL_HEADER_CHARACTERS)
    const commaIndex = header.indexOf(',')
    const descriptor = commaIndex > 5 ? header.slice(5, commaIndex) : ''
    const base64Suffix = ';base64'
    if (!descriptor.toLowerCase().endsWith(base64Suffix)) throw malformedMediaData()
    const dataMimeType = normalizeMimeType(descriptor.slice(0, -base64Suffix.length), kind)
    const claimed = normalizeMimeType(claimedMimeType, kind)
    if (dataMimeType.split(';', 1)[0] !== claimed.split(';', 1)[0]) {
      throw new CliRequestError('unavailable', 'Provider returned conflicting media types', {
        httpStatus: 503
      })
    }
    mimeType = dataMimeType
    encoded = encoded.slice(commaIndex + 1)
  }

  if (encoded.length > MAX_ENCODED_MEDIA_CHARACTERS) {
    throw new CliRequestError('result_too_large', 'Generated media exceeds the byte limit', {
      httpStatus: 413
    })
  }
  if (!encoded || encoded.length % 4 !== 0) throw malformedMediaData()
  if (decodedBase64Length(encoded) > MAX_GENERATED_MEDIA_BYTES) {
    throw new CliRequestError('result_too_large', 'Generated media exceeds the byte limit', {
      httpStatus: 413
    })
  }
  return {
    mimeType: normalizeMimeType(mimeType, kind),
    data: decodeBase64(encoded),
    expectedBytes: decodedBase64Length(encoded)
  }
}

async function resolveCachedImage(
  value: string,
  claimedMimeType: string,
  cacheDirectory: string
): Promise<ResolvedGeneratedMedia> {
  const decodedPath = decodeUriPath(value.slice('imgcache://'.length))
  const resolvedCacheDirectory = path.resolve(cacheDirectory)
  const cacheDirectoryStat = await lstat(resolvedCacheDirectory).catch(() => null)
  if (!cacheDirectoryStat?.isDirectory() || cacheDirectoryStat.isSymbolicLink()) {
    throw new CliRequestError('unavailable', 'Generated media cache is unavailable', {
      httpStatus: 503,
      retriable: true
    })
  }
  if (typeof process.getuid === 'function' && cacheDirectoryStat.uid !== process.getuid()) {
    throw new CliRequestError('unavailable', 'Generated media cache has an invalid owner', {
      httpStatus: 503
    })
  }
  if (!CACHE_FILENAME_PATTERN.test(decodedPath) || WINDOWS_DEVICE_NAME_PATTERN.test(decodedPath)) {
    throw new CliRequestError('unavailable', 'Provider returned an invalid cached media path', {
      httpStatus: 503
    })
  }
  const filePath = path.resolve(resolvedCacheDirectory, decodedPath)
  const relativePath = path.relative(resolvedCacheDirectory, filePath)
  if (
    !relativePath ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath) ||
    decodedPath === '.' ||
    decodedPath === '..'
  ) {
    throw new CliRequestError('unavailable', 'Provider returned an invalid cached media path', {
      httpStatus: 503
    })
  }

  const before = await lstat(filePath).catch(() => null)
  if (
    !before?.isFile() ||
    before.isSymbolicLink() ||
    before.size <= 0 ||
    before.size > MAX_GENERATED_MEDIA_BYTES
  ) {
    throw new CliRequestError('unavailable', 'Generated media cache entry is unavailable', {
      httpStatus: 503,
      retriable: true
    })
  }
  const handle = await open(filePath, 'r').catch(() => null)
  if (!handle) {
    throw new CliRequestError('unavailable', 'Generated media cache entry is unavailable', {
      httpStatus: 503,
      retriable: true
    })
  }
  const opened = await handle.stat().catch(() => null)
  if (
    !opened?.isFile() ||
    opened.size !== before.size ||
    opened.dev !== before.dev ||
    opened.ino !== before.ino
  ) {
    await handle.close().catch(() => undefined)
    throw new CliRequestError('unavailable', 'Generated media cache entry changed before use', {
      httpStatus: 503,
      retriable: true
    })
  }
  try {
    const stream = handle.createReadStream({ autoClose: false, end: opened.size - 1 })
    return {
      mimeType: normalizeMimeType(claimedMimeType, 'image'),
      data: stream,
      expectedBytes: opened.size,
      dispose: async () => {
        if (!stream.destroyed) stream.destroy()
        await handle.close().catch(() => undefined)
      }
    }
  } catch (error) {
    await handle.close().catch(() => undefined)
    throw error
  }
}

export async function resolveGeneratedMedia(
  value: string,
  claimedMimeType: string,
  kind: GeneratedMediaKind,
  cacheDirectory: string
): Promise<ResolvedGeneratedMedia> {
  if (value.length > MAX_ENCODED_MEDIA_CHARACTERS + 1_024) {
    throw new CliRequestError('result_too_large', 'Generated media exceeds the byte limit', {
      httpStatus: 413
    })
  }
  const normalized = value.trim()
  if (!normalized) {
    throw new CliRequestError('unavailable', `Provider returned empty ${kind} output`, {
      httpStatus: 503,
      retriable: true
    })
  }
  if (normalized.startsWith('imgcache://')) {
    if (kind !== 'image') {
      throw new CliRequestError(
        'unavailable',
        'Provider returned an invalid media cache reference',
        {
          httpStatus: 503
        }
      )
    }
    return await resolveCachedImage(normalized, claimedMimeType, cacheDirectory)
  }
  if (/^https?:\/\//i.test(normalized)) {
    throw new CliRequestError('unavailable', 'Remote generated-media URLs are not accepted', {
      httpStatus: 503,
      retriable: true
    })
  }
  return resolveBase64(normalized, claimedMimeType, kind)
}
