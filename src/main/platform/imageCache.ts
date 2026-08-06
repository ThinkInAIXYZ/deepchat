import fs from 'node:fs'
import path from 'node:path'
import dns from 'node:dns/promises'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { app } from 'electron'
import { nanoid } from 'nanoid'
import axios, { type AxiosRequestConfig } from 'axios'

const IMGCACHE_URL_PREFIX = 'imgcache://'
const MAX_CACHED_IMAGE_BYTES = 8 * 1024 * 1024
const IMAGE_CACHE_TIMEOUT_MS = 10_000
const MAX_IMAGE_REDIRECTS = 5
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308])

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(IMAGE_MIME_BY_EXTENSION).map(([extension, mimeType]) => [
    mimeType,
    extension.slice(1)
  ])
)
IMAGE_EXTENSION_BY_MIME['image/vnd.microsoft.icon'] = 'ico'
IMAGE_EXTENSION_BY_MIME['image/jpg'] = 'jpg'
IMAGE_EXTENSION_BY_MIME['image/x-ms-bmp'] = 'bmp'

const blockedImageNetworks = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const) {
  blockedImageNetworks.addSubnet(network, prefix, 'ipv4')
}
blockedImageNetworks.addAddress('::', 'ipv6')
blockedImageNetworks.addAddress('::1', 'ipv6')
for (const [network, prefix] of [
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
] as const) {
  blockedImageNetworks.addSubnet(network, prefix, 'ipv6')
}

export type CacheImageOptions = {
  signal?: AbortSignal
  allowPrivateNetwork?: boolean
}

function toMimeType(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === 'string') ?? ''
  }
  return ''
}

function getImageExtensionFromMimeType(value: unknown): string | undefined {
  const mimeType = toMimeType(value).split(';', 1)[0].trim().toLowerCase()
  return IMAGE_EXTENSION_BY_MIME[mimeType]
}

function isBlockedImageAddress(address: string, family: number): boolean {
  return blockedImageNetworks.check(address, family === 6 ? 'ipv6' : 'ipv4')
}

const lookupPublicImageAddress: LookupFunction = (hostname, options, callback) => {
  const family = options.family === 4 || options.family === 6 ? options.family : undefined
  void dns
    .lookup(hostname, { all: true, verbatim: true, ...(family ? { family } : {}) })
    .then((addresses) => {
      if (addresses.length === 0) {
        throw new Error(`Image host did not resolve: ${hostname}`)
      }
      if (addresses.some(({ address, family }) => isBlockedImageAddress(address, family))) {
        throw new Error(`Image URL resolves to a non-public address: ${hostname}`)
      }
      if (options.all) {
        callback(null, addresses)
        return
      }
      callback(null, addresses[0].address, addresses[0].family)
    })
    .catch((error: unknown) => {
      callback(error instanceof Error ? error : new Error(String(error)), '')
    })
}

function assertAllowedImageUrl(url: URL, allowPrivateNetwork: boolean): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Unsupported image URL protocol')
  }
  if (allowPrivateNetwork) return

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const family = isIP(hostname)
  if (family !== 0 && isBlockedImageAddress(hostname, family)) {
    throw new Error(`Image URL uses a non-public address: ${hostname}`)
  }
}

async function cacheImageFromUrl(
  url: string,
  cacheDir: string,
  fileName: string,
  options: CacheImageOptions
): Promise<string> {
  const timeoutSignal = AbortSignal.timeout(IMAGE_CACHE_TIMEOUT_MS)
  const requestSignal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal
  const allowPrivateNetwork = options.allowPrivateNetwork !== false

  try {
    let currentUrl = new URL(url)
    for (let redirectCount = 0; ; redirectCount += 1) {
      requestSignal.throwIfAborted()
      assertAllowedImageUrl(currentUrl, allowPrivateNetwork)
      const response = await axios({
        method: 'get',
        url: currentUrl.toString(),
        responseType: 'arraybuffer',
        timeout: IMAGE_CACHE_TIMEOUT_MS,
        signal: requestSignal,
        maxRedirects: 0,
        maxContentLength: MAX_CACHED_IMAGE_BYTES,
        maxBodyLength: MAX_CACHED_IMAGE_BYTES,
        ...(allowPrivateNetwork
          ? {}
          : {
              proxy: false,
              lookup: lookupPublicImageAddress as NonNullable<AxiosRequestConfig['lookup']>
            }),
        validateStatus: (status) =>
          (status >= 200 && status < 300) || REDIRECT_STATUS_CODES.has(status)
      })

      if (REDIRECT_STATUS_CODES.has(response.status)) {
        const location = toMimeType(response.headers.location)
        if (!location || redirectCount >= MAX_IMAGE_REDIRECTS) {
          throw new Error('Image URL redirect limit exceeded')
        }
        currentUrl = new URL(location, currentUrl)
        continue
      }

      const extension = getImageExtensionFromMimeType(response.headers['content-type'])
      if (!extension) {
        throw new Error('Unsupported image MIME type')
      }
      const data = Buffer.from(response.data)
      if (data.byteLength > MAX_CACHED_IMAGE_BYTES) {
        throw new Error('Image exceeds the cache size limit')
      }
      requestSignal.throwIfAborted()
      const saveFileName = `${fileName}.${extension}`
      await fs.promises.writeFile(path.join(cacheDir, saveFileName), data, {
        signal: requestSignal
      })
      return `imgcache://${saveFileName}`
    }
  } catch (error) {
    if (options.signal?.aborted) throw error
    console.error('下载图片失败:', error)
    return url
  }
}

async function cacheImageFromBase64(
  base64Data: string,
  cacheDir: string,
  fileName: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    signal?.throwIfAborted()
    const matches = base64Data.match(/^data:([^;]+);base64,(.*)$/)
    if (!matches || matches.length !== 3) {
      console.warn('无效的Base64图片数据')
      return base64Data
    }
    const extension = getImageExtensionFromMimeType(matches[1])
    if (!extension) {
      console.warn('不支持的图片MIME类型')
      return base64Data
    }
    const normalizedBase64 = matches[2].replace(/\s/g, '')
    const paddingBytes = normalizedBase64.endsWith('==')
      ? 2
      : normalizedBase64.endsWith('=')
        ? 1
        : 0
    const estimatedBytes = Math.floor((normalizedBase64.length * 3) / 4) - paddingBytes
    if (estimatedBytes > MAX_CACHED_IMAGE_BYTES) {
      console.warn('图片超过缓存大小限制')
      return base64Data
    }
    const data = Buffer.from(normalizedBase64, 'base64')
    if (data.byteLength > MAX_CACHED_IMAGE_BYTES) {
      console.warn('图片超过缓存大小限制')
      return base64Data
    }
    signal?.throwIfAborted()
    const saveFileName = `${fileName}.${extension}`
    await fs.promises.writeFile(
      path.join(cacheDir, saveFileName),
      data,
      signal ? { signal } : undefined
    )
    return `imgcache://${saveFileName}`
  } catch (error) {
    if (signal?.aborted) throw error
    console.error('保存Base64图片失败:', error)
    return base64Data
  }
}

export async function cacheImage(
  imageData: string,
  options: CacheImageOptions = {}
): Promise<string> {
  options.signal?.throwIfAborted()
  if (imageData.trim().toLowerCase().startsWith(IMGCACHE_URL_PREFIX)) return imageData.trim()

  const cacheDir = path.join(app.getPath('userData'), 'images')
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
  const fileName = `img_${Date.now()}_${nanoid(8)}`

  if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
    return cacheImageFromUrl(imageData, cacheDir, fileName, options)
  }
  if (imageData.startsWith('data:image/')) {
    return cacheImageFromBase64(imageData, cacheDir, fileName, options.signal)
  }
  console.warn('不支持的图片格式')
  return imageData
}

function safeDecodePath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('Invalid cached image reference')
  }
}

function isPathInsideRoot(rootDir: string, filePath: string): boolean {
  const relativePath = path.relative(rootDir, filePath)
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

export async function resolveCachedImageDataUrl(
  source: string,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  const normalizedSource = source.trim()
  if (!normalizedSource.toLowerCase().startsWith(IMGCACHE_URL_PREFIX)) {
    throw new Error('Unsupported cached image reference')
  }

  const cacheDir = path.join(app.getPath('userData'), 'images')
  const cachePath = safeDecodePath(normalizedSource.slice(IMGCACHE_URL_PREFIX.length))
  const fullPath = path.resolve(cacheDir, cachePath)
  if (!isPathInsideRoot(cacheDir, fullPath)) {
    throw new Error('Invalid cached image path')
  }

  const fileStat = await fs.promises.lstat(fullPath)
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error('Cached image reference is not a regular file')
  }
  if (fileStat.size > MAX_CACHED_IMAGE_BYTES) {
    throw new Error('Cached image exceeds the MCP image input limit')
  }

  const [realCacheDir, realFilePath] = await Promise.all([
    fs.promises.realpath(cacheDir),
    fs.promises.realpath(fullPath)
  ])
  if (!isPathInsideRoot(realCacheDir, realFilePath)) {
    throw new Error('Invalid cached image path')
  }

  const mimeType = IMAGE_MIME_BY_EXTENSION[path.extname(realFilePath).toLowerCase()]
  if (!mimeType) {
    throw new Error('Unsupported cached image type')
  }

  signal?.throwIfAborted()
  const data = await fs.promises.readFile(realFilePath, { signal })
  signal?.throwIfAborted()
  return `data:${mimeType};base64,${data.toString('base64')}`
}
