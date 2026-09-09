import type { MCPContentItem, ToolCallImagePreview } from '@shared/types/core/mcp'
import type { CacheImageOptions } from '@/platform/imageCache'
import { awaitWithAbort } from './awaitWithAbort'

export type CacheImageCallback = (data: string, options?: CacheImageOptions) => Promise<string>

type ImagePreviewInput = {
  data: string
  mimeType: string
  title?: string
  source: ToolCallImagePreview['source']
  replaceValue?: string
}

type ExtractToolCallImagePreviewsParams = {
  toolName?: string
  toolArgs?: string
  content: string | MCPContentItem[]
  cacheImage?: CacheImageCallback
  signal?: AbortSignal
}

const DATA_IMAGE_URL_PATTERN = /data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\r\n]+/g
const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi
const TRAILING_URL_PUNCTUATION_PATTERN = /[),.;:!?\]}，。；：！？）】]+$/
const IMAGE_PATH_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i
const MAX_TOOL_CALL_IMAGE_PREVIEWS = 4

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function inferMimeType(data: string, fallback = 'image/png'): string {
  const dataUrlMatch = data.match(/^data:([^;]+);base64,/)
  if (dataUrlMatch?.[1]) {
    return dataUrlMatch[1]
  }

  const normalized = data.toLowerCase().split(/[?#]/)[0]
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg'
  if (normalized.endsWith('.gif')) return 'image/gif'
  if (normalized.endsWith('.webp')) return 'image/webp'
  if (normalized.endsWith('.bmp')) return 'image/bmp'
  if (normalized.endsWith('.ico')) return 'image/x-icon'
  if (normalized.endsWith('.avif')) return 'image/avif'
  if (normalized.endsWith('.svg')) return 'image/svg+xml'
  return fallback
}

function isImageReference(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('data:image/')) return true
  if (trimmed.startsWith('imgcache://')) return true
  if (/\s/.test(trimmed)) return false
  try {
    const url = new URL(trimmed)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      IMAGE_PATH_EXTENSION_PATTERN.test(url.pathname)
    )
  } catch {
    return false
  }
}

function extractEmbeddedHttpImageReferences(content: string): string[] {
  return (content.match(HTTP_URL_PATTERN) ?? [])
    .map((value) => value.replace(TRAILING_URL_PUNCTUATION_PATTERN, ''))
    .filter(isImageReference)
}

function normalizeImagePayload(data: string, mimeType: string): string {
  const trimmed = data.trim()
  if (
    trimmed.toLowerCase().startsWith('data:image/') ||
    trimmed.toLowerCase().startsWith('imgcache://') ||
    trimmed.toLowerCase().startsWith('http://') ||
    trimmed.toLowerCase().startsWith('https://')
  ) {
    return trimmed
  }

  return `data:${mimeType || 'image/png'};base64,${trimmed}`
}

/**
 * Normalizes a preview payload before it is handed to the image cache: lowercases a case-insensitive
 * `data:` scheme so `imageCache`'s base64 router recognizes it, and wraps bare base64 into a full
 * data URL. Non-base64 references (HTTP(S) URLs, `imgcache://`) are returned unchanged.
 */
function normalizeBackstopPreviewData(data: string, mimeType: string): string {
  const trimmed = data.trim()
  if (/^data:/i.test(trimmed)) {
    return `data:${trimmed.slice('data:'.length)}`
  }
  if (/^https?:\/\//i.test(trimmed) || trimmed.toLowerCase().startsWith('imgcache://')) {
    return trimmed
  }
  return `data:${mimeType || 'image/png'};base64,${trimmed}`
}

async function cachePreviewData(
  data: string,
  cacheImage?: CacheImageCallback,
  signal?: AbortSignal
): Promise<string | undefined> {
  if (data.trim().toLowerCase().startsWith('imgcache://')) {
    return data.trim()
  }
  if (!cacheImage) {
    return undefined
  }

  try {
    signal?.throwIfAborted()
    const cachedData = await awaitWithAbort(cacheImage(data, { signal }), signal)
    const cachedDataTrimmed = cachedData.trim()
    return cachedDataTrimmed.toLowerCase().startsWith('imgcache://') ? cachedDataTrimmed : undefined
  } catch (error) {
    if (signal?.aborted) throw error
    return undefined
  }
}

function resolveScreenshotMimeType(format: unknown): string {
  if (typeof format !== 'string') {
    return 'image/png'
  }
  const normalized = format.trim().toLowerCase()
  if (normalized === 'jpeg' || normalized === 'jpg') return 'image/jpeg'
  if (normalized === 'webp') return 'image/webp'
  return 'image/png'
}

function extractScreenshotPreview(
  toolName: string | undefined,
  toolArgs: string | undefined,
  content: string | MCPContentItem[]
): ImagePreviewInput | null {
  if (toolName !== 'cdp_send' || typeof content !== 'string') {
    return null
  }

  const parsedArgs = parseJsonRecord(toolArgs)
  if (!parsedArgs || parsedArgs.method !== 'Page.captureScreenshot') {
    return null
  }

  const parsedContent = parseJsonRecord(content)
  const rawData = typeof parsedContent?.data === 'string' ? parsedContent.data.trim() : ''
  if (!rawData) {
    return null
  }

  const screenshotParams = parseJsonRecord(parsedArgs.params)
  const mimeType = resolveScreenshotMimeType(screenshotParams?.format)

  return {
    data: normalizeImagePayload(rawData, mimeType),
    mimeType,
    title: 'Page.captureScreenshot',
    source: 'screenshot'
  }
}

function collectJsonImageReferences(value: unknown, output: ImagePreviewInput[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (isImageReference(trimmed)) {
      output.push({
        data: trimmed,
        mimeType: inferMimeType(trimmed),
        ...(trimmed.startsWith('http://') || trimmed.startsWith('https://')
          ? { replaceValue: trimmed }
          : {}),
        source: 'tool_output'
      })
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonImageReferences(item, output)
    }
    return
  }

  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) {
      collectJsonImageReferences(item, output)
    }
  }
}

function extractStringImagePreviews(content: string): ImagePreviewInput[] {
  const previews: ImagePreviewInput[] = []
  const trimmed = content.trim()

  if (isImageReference(trimmed)) {
    previews.push({
      data: trimmed,
      mimeType: inferMimeType(trimmed),
      ...(trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? { replaceValue: trimmed }
        : {}),
      source: 'tool_output'
    })
  }

  for (const reference of extractEmbeddedHttpImageReferences(trimmed)) {
    previews.push({
      data: reference,
      mimeType: inferMimeType(reference),
      replaceValue: reference,
      source: 'tool_output'
    })
  }

  const matches = trimmed.match(DATA_IMAGE_URL_PATTERN) ?? []
  for (const match of matches) {
    previews.push({
      data: match.replace(/\s+/g, ''),
      mimeType: inferMimeType(match),
      source: 'tool_output'
    })
  }

  const parsed = parseJsonValue(trimmed)
  if (parsed !== null) {
    collectJsonImageReferences(parsed, previews)
  }

  return previews
}

function extractStructuredImagePreviews(content: MCPContentItem[]): ImagePreviewInput[] {
  return content.flatMap((item): ImagePreviewInput[] => {
    if (item.type === 'text') {
      return extractStringImagePreviews(item.text)
    }
    if (item.type === 'image') {
      const mimeType = item.mimeType || 'image/png'
      return [
        {
          data: normalizeImagePayload(item.data, mimeType),
          mimeType,
          source: 'mcp_image' as const
        }
      ]
    }
    return []
  })
}

function replaceImageReferences(
  content: string | MCPContentItem[],
  replacements: ReadonlyMap<string, string>
): string | MCPContentItem[] {
  if (replacements.size === 0) {
    return content
  }

  const replaceExtractedReferences = (value: string): string =>
    value.replace(HTTP_URL_PATTERN, (match) => {
      const reference = match.replace(TRAILING_URL_PUNCTUATION_PATTERN, '')
      const cached = replacements.get(reference)
      return cached ? `${cached}${match.slice(reference.length)}` : match
    })

  if (typeof content === 'string') {
    return replaceExtractedReferences(content)
  }

  return content.map((item) =>
    item.type === 'text' ? { ...item, text: replaceExtractedReferences(item.text) } : item
  )
}

export async function prepareToolCallImageContent(
  params: ExtractToolCallImagePreviewsParams
): Promise<{
  content: string | MCPContentItem[]
  imagePreviews: ToolCallImagePreview[]
}> {
  params.signal?.throwIfAborted()
  const inputs: ImagePreviewInput[] = []
  const screenshotPreview = extractScreenshotPreview(
    params.toolName,
    params.toolArgs,
    params.content
  )
  if (screenshotPreview) {
    inputs.push(screenshotPreview)
  }

  if (Array.isArray(params.content)) {
    inputs.push(...extractStructuredImagePreviews(params.content))
  } else {
    inputs.push(...extractStringImagePreviews(params.content))
  }

  const previews: ToolCallImagePreview[] = []
  const replacements = new Map<string, string>()
  const seenInputs = new Set<string>()
  const seen = new Set<string>()
  for (const input of inputs) {
    params.signal?.throwIfAborted()
    const inputKey = input.data.trim()
    if (seenInputs.has(inputKey)) {
      continue
    }
    if (seenInputs.size >= MAX_TOOL_CALL_IMAGE_PREVIEWS) {
      break
    }
    seenInputs.add(inputKey)
    const data = await cachePreviewData(input.data, params.cacheImage, params.signal)
    if (data && seen.has(data)) {
      continue
    }
    if (data) {
      seen.add(data)
    }
    if (data && input.replaceValue) {
      replacements.set(input.replaceValue, data)
    }
    previews.push({
      id: `${input.source}-${previews.length + 1}`,
      ...(data ? { data } : {}),
      mimeType: data ? inferMimeType(data, input.mimeType) : input.mimeType,
      ...(input.title ? { title: input.title } : {}),
      source: input.source
    })
  }

  params.signal?.throwIfAborted()
  return {
    content: replaceImageReferences(params.content, replacements),
    imagePreviews: previews
  }
}

export async function extractToolCallImagePreviews(
  params: ExtractToolCallImagePreviewsParams
): Promise<ToolCallImagePreview[]> {
  return (await prepareToolCallImageContent(params)).imagePreviews
}

/**
 * Backstop for tools that return `imagePreviews` directly (bypassing extraction): rewrites any
 * inline base64 payload (data URL or bare base64, in any casing) to an on-disk `imgcache://`
 * reference to reduce payloads reaching message persistence, IPC, and the renderer. Previews
 * that cannot be cached are left unchanged. At most `MAX_TOOL_CALL_IMAGE_PREVIEWS` distinct
 * inline payloads are processed per call; duplicates and excess inline previews are dropped.
 *
 * Tools returning `imagePreviews` directly must keep inline image data out of textual `content`;
 * this helper only rewrites the preview array.
 */
export async function cacheToolCallImagePreviews(params: {
  imagePreviews: ToolCallImagePreview[]
  cacheImage?: CacheImageCallback
  signal?: AbortSignal
}): Promise<ToolCallImagePreview[]> {
  const { imagePreviews, cacheImage, signal } = params
  signal?.throwIfAborted()
  if (!cacheImage || imagePreviews.length === 0) {
    return imagePreviews
  }

  let changed = false
  const resolved: ToolCallImagePreview[] = []
  const seenInputs = new Set<string>()
  const seen = new Set<string>()
  for (const preview of imagePreviews) {
    signal?.throwIfAborted()
    const rawData = preview.data?.trim()
    if (
      !rawData ||
      rawData.toLowerCase().startsWith('imgcache://') ||
      /^https?:\/\//i.test(rawData)
    ) {
      resolved.push(preview)
      continue
    }
    const normalized = normalizeBackstopPreviewData(rawData, preview.mimeType)
    if (!/^data:image\//i.test(normalized)) {
      resolved.push(preview)
      continue
    }
    const inputKey = normalized
    if (seenInputs.has(inputKey)) {
      changed = true
      continue
    }
    if (seenInputs.size >= MAX_TOOL_CALL_IMAGE_PREVIEWS) {
      changed = true
      continue
    }
    seenInputs.add(inputKey)
    const cached = await cachePreviewData(normalized, cacheImage, signal)
    if (!cached) {
      resolved.push(preview)
      continue
    }
    if (seen.has(cached)) {
      changed = true
      continue
    }
    seen.add(cached)
    changed = true
    resolved.push({ ...preview, data: cached, mimeType: inferMimeType(cached, preview.mimeType) })
  }
  signal?.throwIfAborted()
  return changed ? resolved : imagePreviews
}
