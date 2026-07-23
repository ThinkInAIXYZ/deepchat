export const LIGHT_OCR_PROTOCOL_VERSION = 1
export const LIGHT_OCR_MAX_PROTOCOL_LINE_BYTES = 4 * 1024 * 1024

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

export type LightOcrHelperMessage = LightOcrHelperHello | LightOcrHelperResponse

export function isLightOcrHelperMessage(value: unknown): value is LightOcrHelperMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>

  if (candidate.type === 'hello') {
    return (
      typeof candidate.protocolVersion === 'number' &&
      typeof candidate.nodeVersion === 'string' &&
      typeof candidate.pid === 'number'
    )
  }

  if (candidate.type === 'result') {
    return typeof candidate.id === 'string' && 'data' in candidate
  }

  if (candidate.type === 'error') {
    if (
      typeof candidate.id !== 'string' ||
      !candidate.error ||
      typeof candidate.error !== 'object'
    ) {
      return false
    }
    const error = candidate.error as Record<string, unknown>
    return (
      typeof error.code === 'string' &&
      typeof error.message === 'string' &&
      (error.detail === undefined || typeof error.detail === 'string')
    )
  }

  return false
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
  return typeof value === 'number' && Number.isInteger(value) && value > 0
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
