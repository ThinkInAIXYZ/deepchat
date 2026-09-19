export const LIGHT_OCR_PROTOCOL_VERSION = 2
export const LIGHT_OCR_MAX_PROTOCOL_LINE_BYTES = 4 * 1024 * 1024
export const LIGHT_OCR_HELPER_MAX_INPUT_BYTES = 50 * 1024 * 1024
export const LIGHT_OCR_DOCUMENT_MAX_PAGES = 100
export const LIGHT_OCR_DOCUMENT_MAX_PAGE_PIXELS = 4096 * 4096
export const LIGHT_OCR_DOCUMENT_MAX_TOTAL_PIXELS = 100 * 1024 * 1024
export const LIGHT_OCR_DOCUMENT_MAX_LINES_PER_PAGE = 20_000
export const LIGHT_OCR_DOCUMENT_MAX_LINE_CHARACTERS = 32_768
const LIGHT_OCR_MAX_ERROR_CODE_CHARACTERS = 128
const LIGHT_OCR_MAX_ERROR_TEXT_CHARACTERS = 2_048

export type LightOcrBackendPreference = 'auto' | 'cpu'
export type LightOcrRecognitionStrategy = 'bounded-960' | 'tiled-v1'

export interface LightOcrStageExecutionStatus {
  actualProviderChain: string[]
  precision: string
  qualificationId: string
}

export interface LightOcrEngineStatus {
  coreVersion: string
  modelBundleId: string
  requestedProvider: LightOcrBackendPreference
  strategy: LightOcrRecognitionStrategy
  detection: LightOcrStageExecutionStatus
  recognition: LightOcrStageExecutionStatus
}

export interface LightOcrPoint {
  x: number
  y: number
}

export interface LightOcrLine {
  text: string
  confidence: number
  box: [LightOcrPoint, LightOcrPoint, LightOcrPoint, LightOcrPoint]
}

export interface LightOcrTimingUs {
  total: number
  decode: number
  inputValidation: number
  detectionPreprocess: number
  detectionInference: number
  detectionPostprocess: number
  detectionMerge: number
  cropAndSort: number
  recognitionPreprocess: number
  recognitionInference: number
  recognitionPostprocess: number
}

export interface LightOcrRecognitionResult {
  lines: LightOcrLine[]
  imageWidth: number
  imageHeight: number
  modelBundleId: string
  timingUs: LightOcrTimingUs
  engine: LightOcrEngineStatus
}

export interface LightOcrDocumentOptions {
  readonly dpi: number
  readonly pageRange: {
    readonly start: number
    readonly end: number
  }
  readonly maxPages: number
  readonly maxFileBytes: number
  readonly maxPagePixels: number
  readonly maxTotalPixels: number
}

export interface LightOcrDocumentTimingUs {
  readonly total: number
  readonly decode: number
  readonly ocr: number
}

export interface LightOcrDocumentPage {
  readonly index: number
  readonly width: number
  readonly height: number
  readonly lines: ReadonlyArray<string>
  readonly modelBundleId: string
  readonly timingUs: LightOcrDocumentTimingUs
}

export type LightOcrHelperRequest =
  | {
      type: 'configure'
      id: string
      backend: LightOcrBackendPreference
      strategy: LightOcrRecognitionStrategy
    }
  | {
      type: 'recognize'
      id: string
      filePath: string
    }
  | {
      type: 'recognize_document'
      id: string
      filePath: string
      backend: LightOcrBackendPreference
      strategy: LightOcrRecognitionStrategy
      options: LightOcrDocumentOptions
    }
  | {
      type: 'document_stop'
      id: string
      targetId: string
    }
  | {
      type: 'cancel'
      id: string
      targetId: string
    }
  | {
      type: 'shutdown'
      id: string
    }

export interface LightOcrHelperHello {
  type: 'hello'
  protocolVersion: number
  nodeVersion: string
  pid: number
}

export type LightOcrHelperResponse =
  | {
      type: 'result'
      id: string
      data: unknown
    }
  | {
      type: 'error'
      id: string
      error: {
        code: string
        message: string
        detail?: string
      }
    }
  | {
      type: 'document_page'
      id: string
      page: LightOcrDocumentPage
    }
  | {
      type: 'request_complete'
      id: string
      emittedPages: number
    }

export type LightOcrHelperMessage = LightOcrHelperHello | LightOcrHelperResponse

export function isLightOcrHelperRequest(value: unknown): value is LightOcrHelperRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  if (!isProtocolId(request.id)) return false

  switch (request.type) {
    case 'configure':
      return isBackend(request.backend) && isStrategy(request.strategy)
    case 'recognize':
      return isPrivateInputPath(request.filePath)
    case 'recognize_document':
      return (
        isPrivateInputPath(request.filePath) &&
        isBackend(request.backend) &&
        isStrategy(request.strategy) &&
        isLightOcrDocumentOptions(request.options)
      )
    case 'document_stop':
    case 'cancel':
      return isProtocolId(request.targetId)
    case 'shutdown':
      return true
    default:
      return false
  }
}

export function isLightOcrHelperMessage(value: unknown): value is LightOcrHelperMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>

  if (candidate.type === 'hello') {
    return (
      isNonNegativeInteger(candidate.protocolVersion) &&
      typeof candidate.nodeVersion === 'string' &&
      candidate.nodeVersion.length > 0 &&
      candidate.nodeVersion.length <= 64 &&
      isPositiveInteger(candidate.pid)
    )
  }

  if (candidate.type === 'result') {
    return isProtocolId(candidate.id) && 'data' in candidate
  }

  if (candidate.type === 'error') {
    if (!isProtocolId(candidate.id) || !candidate.error || typeof candidate.error !== 'object') {
      return false
    }
    const error = candidate.error as Record<string, unknown>
    return (
      typeof error.code === 'string' &&
      error.code.length > 0 &&
      error.code.length <= LIGHT_OCR_MAX_ERROR_CODE_CHARACTERS &&
      typeof error.message === 'string' &&
      error.message.length <= LIGHT_OCR_MAX_ERROR_TEXT_CHARACTERS &&
      (error.detail === undefined ||
        (typeof error.detail === 'string' &&
          error.detail.length <= LIGHT_OCR_MAX_ERROR_TEXT_CHARACTERS))
    )
  }

  if (candidate.type === 'document_page') {
    return isProtocolId(candidate.id) && isLightOcrDocumentPage(candidate.page)
  }

  if (candidate.type === 'request_complete') {
    return isProtocolId(candidate.id) && isNonNegativeInteger(candidate.emittedPages)
  }

  return false
}

export function isLightOcrDocumentOptions(value: unknown): value is LightOcrDocumentOptions {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (!candidate.pageRange || typeof candidate.pageRange !== 'object') return false
  const pageRange = candidate.pageRange as Record<string, unknown>
  if (
    !isPositiveInteger(pageRange.start) ||
    !isPositiveInteger(pageRange.end) ||
    pageRange.end < pageRange.start
  ) {
    return false
  }

  const requestedPages = pageRange.end - pageRange.start + 1
  return (
    isIntegerInRange(candidate.dpi, 36, 600) &&
    isIntegerInRange(candidate.maxPages, 1, LIGHT_OCR_DOCUMENT_MAX_PAGES) &&
    requestedPages <= candidate.maxPages &&
    isIntegerInRange(candidate.maxFileBytes, 1, LIGHT_OCR_HELPER_MAX_INPUT_BYTES) &&
    isIntegerInRange(candidate.maxPagePixels, 1, LIGHT_OCR_DOCUMENT_MAX_PAGE_PIXELS) &&
    isIntegerInRange(candidate.maxTotalPixels, 1, LIGHT_OCR_DOCUMENT_MAX_TOTAL_PIXELS)
  )
}

export function isLightOcrDocumentPage(value: unknown): value is LightOcrDocumentPage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (
    !isNonNegativeInteger(candidate.index) ||
    !isPositiveInteger(candidate.width) ||
    !isPositiveInteger(candidate.height) ||
    candidate.width * candidate.height > LIGHT_OCR_DOCUMENT_MAX_PAGE_PIXELS ||
    !Array.isArray(candidate.lines) ||
    candidate.lines.length > LIGHT_OCR_DOCUMENT_MAX_LINES_PER_PAGE ||
    !candidate.lines.every(
      (line) => typeof line === 'string' && line.length <= LIGHT_OCR_DOCUMENT_MAX_LINE_CHARACTERS
    ) ||
    typeof candidate.modelBundleId !== 'string' ||
    candidate.modelBundleId.length === 0 ||
    candidate.modelBundleId.length > 256
  ) {
    return false
  }
  return isDocumentTiming(candidate.timingUs)
}

export function isLightOcrEngineStatus(value: unknown): value is LightOcrEngineStatus {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.coreVersion === 'string' &&
    typeof candidate.modelBundleId === 'string' &&
    (candidate.requestedProvider === 'auto' || candidate.requestedProvider === 'cpu') &&
    (candidate.strategy === 'bounded-960' || candidate.strategy === 'tiled-v1') &&
    isStageStatus(candidate.detection) &&
    isStageStatus(candidate.recognition)
  )
}

export function isLightOcrRecognitionResult(value: unknown): value is LightOcrRecognitionResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    Array.isArray(candidate.lines) &&
    candidate.lines.every(isOcrLine) &&
    isPositiveInteger(candidate.imageWidth) &&
    isPositiveInteger(candidate.imageHeight) &&
    typeof candidate.modelBundleId === 'string' &&
    isTiming(candidate.timingUs) &&
    isLightOcrEngineStatus(candidate.engine)
  )
}

function isStageStatus(value: unknown): value is LightOcrStageExecutionStatus {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    Array.isArray(candidate.actualProviderChain) &&
    candidate.actualProviderChain.every((provider) => typeof provider === 'string') &&
    typeof candidate.precision === 'string' &&
    typeof candidate.qualificationId === 'string'
  )
}

function isOcrLine(value: unknown): value is LightOcrLine {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.text === 'string' &&
    typeof candidate.confidence === 'number' &&
    Number.isFinite(candidate.confidence) &&
    Array.isArray(candidate.box) &&
    candidate.box.length === 4 &&
    candidate.box.every(isPoint)
  )
}

function isPoint(value: unknown): value is LightOcrPoint {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.x === 'number' &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === 'number' &&
    Number.isFinite(candidate.y)
  )
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  )
}

function isTiming(value: unknown): value is LightOcrTimingUs {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  const keys: Array<keyof LightOcrTimingUs> = [
    'total',
    'decode',
    'inputValidation',
    'detectionPreprocess',
    'detectionInference',
    'detectionPostprocess',
    'detectionMerge',
    'cropAndSort',
    'recognitionPreprocess',
    'recognitionInference',
    'recognitionPostprocess'
  ]
  return keys.every((key) => {
    const timing = candidate[key]
    return typeof timing === 'number' && Number.isFinite(timing) && timing >= 0
  })
}

function isDocumentTiming(value: unknown): value is LightOcrDocumentTimingUs {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return ['total', 'decode', 'ocr'].every((key) => {
    const timing = candidate[key]
    return typeof timing === 'number' && Number.isFinite(timing) && timing >= 0
  })
}

function isBackend(value: unknown): value is LightOcrBackendPreference {
  return value === 'auto' || value === 'cpu'
}

function isStrategy(value: unknown): value is LightOcrRecognitionStrategy {
  return value === 'bounded-960' || value === 'tiled-v1'
}

function isProtocolId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}

function isPrivateInputPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4_096
}
