import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { nanoid } from 'nanoid'
import axios from 'axios'

const IMGCACHE_URL_PREFIX = 'imgcache://'
const MAX_TOOL_INPUT_IMAGE_BYTES = 8 * 1024 * 1024

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

function toMimeType(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === 'string') ?? ''
  }
  return ''
}

function getImageExtensionFromMimeType(value: unknown): string {
  const mimeType = toMimeType(value).toLowerCase()
  if (mimeType.includes('png')) return 'png'
  if (mimeType.includes('gif')) return 'gif'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('svg')) return 'svg'
  return 'jpg'
}

async function cacheImageFromUrl(url: string, cacheDir: string, fileName: string): Promise<string> {
  try {
    const response = await axios({
      method: 'get',
      url,
      responseType: 'arraybuffer',
      timeout: 10000
    })
    const extension = getImageExtensionFromMimeType(response.headers['content-type'])
    const saveFileName = `${fileName}.${extension}`
    await fs.promises.writeFile(path.join(cacheDir, saveFileName), Buffer.from(response.data))
    return `imgcache://${saveFileName}`
  } catch (error) {
    console.error('下载图片失败:', error)
    return url
  }
}

async function cacheImageFromBase64(
  base64Data: string,
  cacheDir: string,
  fileName: string
): Promise<string> {
  try {
    const matches = base64Data.match(/^data:([^;]+);base64,(.*)$/)
    if (!matches || matches.length !== 3) {
      console.warn('无效的Base64图片数据')
      return base64Data
    }
    const extension = getImageExtensionFromMimeType(matches[1])
    const saveFileName = `${fileName}.${extension}`
    await fs.promises.writeFile(
      path.join(cacheDir, saveFileName),
      Buffer.from(matches[2], 'base64')
    )
    return `imgcache://${saveFileName}`
  } catch (error) {
    console.error('保存Base64图片失败:', error)
    return base64Data
  }
}

export async function cacheImage(imageData: string): Promise<string> {
  if (imageData.startsWith(IMGCACHE_URL_PREFIX)) return imageData

  const cacheDir = path.join(app.getPath('userData'), 'images')
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
  const fileName = `img_${Date.now()}_${nanoid(8)}`

  if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
    return cacheImageFromUrl(imageData, cacheDir, fileName)
  }
  if (imageData.startsWith('data:image/')) {
    return cacheImageFromBase64(imageData, cacheDir, fileName)
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
  if (!normalizedSource.startsWith(IMGCACHE_URL_PREFIX)) {
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
  if (fileStat.size > MAX_TOOL_INPUT_IMAGE_BYTES) {
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
