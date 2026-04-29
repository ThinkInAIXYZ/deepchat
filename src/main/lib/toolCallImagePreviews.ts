import type { MCPContentItem, ToolCallImagePreview } from '@shared/types/core/mcp'

type ImagePreviewInput = {
  data: string
  mimeType: string
  title?: string
  source: ToolCallImagePreview['source']
}

type ExtractToolCallImagePreviewsParams = {
  toolName?: string
  toolArgs?: string
  content: string | MCPContentItem[]
  cacheImage?: (data: string) => Promise<string>
}

const DATA_IMAGE_URL_PATTERN = /data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\r\n]+/g
const IMAGE_URL_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)(?:[?#].*)?$/i

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
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return IMAGE_URL_EXTENSION_PATTERN.test(trimmed)
  }
  return false
}

function normalizeImagePayload(data: string, mimeType: string): string {
  const trimmed = data.trim()
  if (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('imgcache://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    return trimmed
  }

  return `data:${mimeType || 'image/png'};base64,${trimmed}`
}

async function cachePreviewData(
  data: string,
  cacheImage?: (data: string) => Promise<string>
): Promise<string | undefined> {
  if (!cacheImage) {
    return undefined
  }

  try {
    const cachedData = await cacheImage(data)
    return cachedData && !cachedData.startsWith('data:image/') ? cachedData : undefined
  } catch {
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
  return content
    .filter((item) => item.type === 'image')
    .map((item) => {
      const mimeType = item.mimeType || 'image/png'
      return {
        data: normalizeImagePayload(item.data, mimeType),
        mimeType,
        source: 'mcp_image' as const
      }
    })
}

export async function extractToolCallImagePreviews(
  params: ExtractToolCallImagePreviewsParams
): Promise<ToolCallImagePreview[]> {
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
  const seen = new Set<string>()
  for (const input of inputs) {
    const data = await cachePreviewData(input.data, params.cacheImage)
    if (data && seen.has(data)) {
      continue
    }
    if (data) {
      seen.add(data)
    }
    previews.push({
      id: `${input.source}-${previews.length + 1}`,
      ...(data ? { data } : {}),
      mimeType: data ? inferMimeType(data, input.mimeType) : input.mimeType,
      ...(input.title ? { title: input.title } : {}),
      source: input.source
    })
  }

  return previews
}
