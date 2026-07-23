import type {
  AttachmentPreparationAction,
  AttachmentPreparationIssue,
  AttachmentPreparationSummary,
  AttachmentUnavailableReason,
  MessageFile,
  SendMessageInput
} from '@shared/types/agent-interface'
import {
  getAttachmentResolvedRepresentation,
  isImageAttachment
} from '@shared/utils/attachmentRepresentation'
import {
  ATTACHMENT_OCR_MAX_TOKENS,
  ATTACHMENT_PREPARATION_MAX_ISSUES
} from '@shared/types/attachment'
import { ImagePreprocessingError } from './imagePreprocessor'
import {
  ImageTextExtractionError,
  truncateOcrText,
  type ImageTextExtractionBatchItem,
  type ImageTextExtractionInput,
  type ImageTextExtractionPort
} from './imageTextExtractionService'
import type { LightOcrBackendPreference } from './lightOcrProtocol'
import { LightOcrProcessHostError } from './lightOcrProcessHost'
import type { OcrRuntimeAvailability } from './ocrRuntimeAssetResolver'

const MAX_OCR_IMAGES_PER_TURN = 8
const MAX_TURN_OCR_TEXT_TOKENS = 16_000

export interface AttachmentOcrRuntimePort extends ImageTextExtractionPort {
  getAvailability(): Promise<OcrRuntimeAvailability>
}

export interface AttachmentCapabilityRouterOptions {
  extraction: AttachmentOcrRuntimePort
  getAutomaticOcrEnabled: () => boolean
  getBackendPreference: () => LightOcrBackendPreference
  getMaxFileSize: () => number
  onDiagnostic?: (event: AttachmentRoutingDiagnostic) => void
}

export interface AttachmentRoutingDiagnostic {
  attachmentIndex: number
  representation: 'image' | 'ocr_text' | 'unavailable'
  reason?: AttachmentUnavailableReason
  tokenCount?: number
  characterCount?: number
  truncated?: boolean
  cacheHit?: boolean
  snapshotReused?: boolean
  strategy?: string
  detectionProviderChain?: string[]
  detectionPrecision?: string
  recognitionProviderChain?: string[]
  recognitionPrecision?: string
  durationMs?: number
}

export interface AttachmentPreparationInput {
  content: SendMessageInput
  supportsVision: boolean
  signal?: AbortSignal
  reusePreparedOcrText?: boolean
  preserveResolvedRepresentations?: boolean
  emitDiagnostics?: boolean
}

export interface AttachmentPreparationResult {
  content: SendMessageInput
  summary: AttachmentPreparationSummary
}

interface OcrCandidate {
  attachmentIndex: number
  file: MessageFile
}

type OcrDiagnosticContext = Omit<
  AttachmentRoutingDiagnostic,
  'attachmentIndex' | 'representation' | 'tokenCount' | 'characterCount' | 'truncated'
>

export class AttachmentCapabilityRouter {
  constructor(private readonly options: AttachmentCapabilityRouterOptions) {}

  async prepare(input: AttachmentPreparationInput): Promise<AttachmentPreparationResult> {
    throwIfAborted(input.signal)
    const files: MessageFile[] = (input.content.files ?? []).map((file) => {
      const { resolvedRepresentation: _resolvedRepresentation, ...publicFile } = file
      return {
        ...publicFile,
        metadata: file.metadata ? { ...file.metadata } : undefined
      }
    })
    const issues: AttachmentPreparationIssue[] = []
    const candidates: OcrCandidate[] = []
    const routingDiagnostics: AttachmentRoutingDiagnostic[] = []
    const ocrDiagnostics = new Map<number, OcrDiagnosticContext>()
    const automaticOcrEnabled = this.options.getAutomaticOcrEnabled()

    for (let attachmentIndex = 0; attachmentIndex < files.length; attachmentIndex += 1) {
      const sourceFile = input.content.files?.[attachmentIndex]
      const file = files[attachmentIndex]
      if (!sourceFile || !isImageAttachment(sourceFile)) continue

      const preference = sourceFile.requestedRepresentation ?? 'auto'
      if (input.content.attachmentFallbackPolicy === 'send_without_image_content') {
        this.markUnavailable(
          file,
          attachmentIndex,
          'user_skipped_image_content',
          issues,
          routingDiagnostics
        )
        continue
      }

      const existing = getAttachmentResolvedRepresentation(sourceFile)
      if (input.preserveResolvedRepresentations && existing) {
        this.preserveResolvedRepresentation({
          file,
          existing,
          attachmentIndex,
          supportsVision: input.supportsVision,
          issues,
          routingDiagnostics,
          ocrDiagnostics
        })
        continue
      }

      if (input.supportsVision && preference !== 'ocr_text') {
        if (!prepareLlmFriendlyImagePayload(file)) {
          this.markUnavailable(
            file,
            attachmentIndex,
            'image_payload_unavailable',
            issues,
            routingDiagnostics
          )
          continue
        }
        file.resolvedRepresentation = { kind: 'image' }
        routingDiagnostics.push({ attachmentIndex, representation: 'image' })
        continue
      }

      if (!input.supportsVision && preference === 'image') {
        this.markUnavailable(
          file,
          attachmentIndex,
          'requested_image_requires_vision',
          issues,
          routingDiagnostics
        )
        continue
      }

      if (!input.supportsVision && preference === 'auto' && !automaticOcrEnabled) {
        this.markUnavailable(
          file,
          attachmentIndex,
          'automatic_ocr_disabled',
          issues,
          routingDiagnostics
        )
        continue
      }

      if (input.reusePreparedOcrText && existing?.kind === 'ocr_text') {
        file.resolvedRepresentation = existing
        ocrDiagnostics.set(attachmentIndex, { snapshotReused: true })
        continue
      }

      candidates.push({ attachmentIndex, file })
    }

    if (candidates.length > 0) {
      await this.resolveOcrCandidates(
        candidates,
        issues,
        routingDiagnostics,
        ocrDiagnostics,
        input.signal
      )
    }
    throwIfAborted(input.signal)
    applyTurnOcrTextBudget(files)
    this.appendOcrDiagnostics(files, ocrDiagnostics, routingDiagnostics)
    if (input.emitDiagnostics !== false) {
      for (const diagnostic of routingDiagnostics) this.emitDiagnostic(diagnostic)
    }

    const summary = buildPreparationSummary({
      content: input.content,
      files,
      issues,
      supportsVision: input.supportsVision
    })
    return {
      content: {
        ...input.content,
        files,
        // The fallback is a pending-input instruction, not a fact stored with the message.
        attachmentFallbackPolicy: input.content.attachmentFallbackPolicy
      },
      summary
    }
  }

  private async resolveOcrCandidates(
    candidates: OcrCandidate[],
    issues: AttachmentPreparationIssue[],
    routingDiagnostics: AttachmentRoutingDiagnostic[],
    ocrDiagnostics: Map<number, OcrDiagnosticContext>,
    signal?: AbortSignal
  ): Promise<void> {
    const processable = candidates.slice(0, MAX_OCR_IMAGES_PER_TURN)
    for (const candidate of candidates.slice(MAX_OCR_IMAGES_PER_TURN)) {
      this.markUnavailable(
        candidate.file,
        candidate.attachmentIndex,
        'image_limit_exceeded',
        issues,
        routingDiagnostics
      )
    }

    const availability = await this.options.extraction.getAvailability()
    throwIfAborted(signal)
    if (availability.status === 'unavailable') {
      for (const candidate of processable) {
        this.markUnavailable(
          candidate.file,
          candidate.attachmentIndex,
          'ocr_runtime_unavailable',
          issues,
          routingDiagnostics
        )
      }
      return
    }

    const backend = this.options.getBackendPreference()
    const maxFileSize = this.options.getMaxFileSize()
    let results: ImageTextExtractionBatchItem[]
    try {
      results = await this.options.extraction.extractBatch(
        processable.map(
          (candidate): ImageTextExtractionInput => ({
            filePath: candidate.file.path,
            maxFileSize,
            backend,
            priority: 'interactive',
            signal
          })
        )
      )
    } catch (error) {
      throwIfCancelled(error, signal)
      const reason = mapExtractionFailure(error)
      for (const candidate of processable) {
        this.markUnavailable(
          candidate.file,
          candidate.attachmentIndex,
          reason,
          issues,
          routingDiagnostics
        )
      }
      return
    }

    for (let resultIndex = 0; resultIndex < processable.length; resultIndex += 1) {
      const candidate = processable[resultIndex]
      const result = results[resultIndex]
      if (!result || result.status === 'rejected') {
        const error = result?.reason
        throwIfCancelled(error, signal)
        this.markUnavailable(
          candidate.file,
          candidate.attachmentIndex,
          mapExtractionFailure(error),
          issues,
          routingDiagnostics
        )
        continue
      }

      if (!result.value.text.trim() || result.value.tokenCount <= 0) {
        this.markUnavailable(
          candidate.file,
          candidate.attachmentIndex,
          'ocr_empty',
          issues,
          routingDiagnostics
        )
        continue
      }

      candidate.file.resolvedRepresentation = {
        kind: 'ocr_text',
        text: result.value.text,
        tokenCount: result.value.tokenCount,
        truncated: result.value.truncated
      }
      ocrDiagnostics.set(candidate.attachmentIndex, {
        cacheHit: result.value.cacheHit,
        strategy: result.value.strategy,
        detectionProviderChain: [...result.value.engine.detection.actualProviderChain],
        detectionPrecision: result.value.engine.detection.precision,
        recognitionProviderChain: [...result.value.engine.recognition.actualProviderChain],
        recognitionPrecision: result.value.engine.recognition.precision,
        durationMs: result.value.timingMs.total
      })
    }
  }

  private markUnavailable(
    file: MessageFile,
    attachmentIndex: number,
    reason: AttachmentUnavailableReason,
    issues: AttachmentPreparationIssue[],
    routingDiagnostics: AttachmentRoutingDiagnostic[]
  ): void {
    file.resolvedRepresentation = { kind: 'unavailable', reason }
    if (issues.length < ATTACHMENT_PREPARATION_MAX_ISSUES) {
      issues.push({ attachmentIndex, reason })
    }
    routingDiagnostics.push({ attachmentIndex, representation: 'unavailable', reason })
  }

  private preserveResolvedRepresentation(input: {
    file: MessageFile
    existing: NonNullable<ReturnType<typeof getAttachmentResolvedRepresentation>>
    attachmentIndex: number
    supportsVision: boolean
    issues: AttachmentPreparationIssue[]
    routingDiagnostics: AttachmentRoutingDiagnostic[]
    ocrDiagnostics: Map<number, OcrDiagnosticContext>
  }): void {
    if (input.existing.kind === 'ocr_text') {
      input.file.resolvedRepresentation = input.existing
      input.ocrDiagnostics.set(input.attachmentIndex, { snapshotReused: true })
      return
    }

    if (input.existing.kind === 'unavailable') {
      this.markUnavailable(
        input.file,
        input.attachmentIndex,
        input.existing.reason,
        input.issues,
        input.routingDiagnostics
      )
      return
    }

    if (!input.supportsVision) {
      this.markUnavailable(
        input.file,
        input.attachmentIndex,
        'requested_image_requires_vision',
        input.issues,
        input.routingDiagnostics
      )
      return
    }
    if (!prepareLlmFriendlyImagePayload(input.file)) {
      this.markUnavailable(
        input.file,
        input.attachmentIndex,
        'image_payload_unavailable',
        input.issues,
        input.routingDiagnostics
      )
      return
    }
    input.file.resolvedRepresentation = { kind: 'image' }
    input.routingDiagnostics.push({
      attachmentIndex: input.attachmentIndex,
      representation: 'image'
    })
  }

  private appendOcrDiagnostics(
    files: MessageFile[],
    diagnostics: Map<number, OcrDiagnosticContext>,
    routingDiagnostics: AttachmentRoutingDiagnostic[]
  ): void {
    for (let attachmentIndex = 0; attachmentIndex < files.length; attachmentIndex += 1) {
      const resolved = getAttachmentResolvedRepresentation(files[attachmentIndex])
      if (resolved?.kind !== 'ocr_text') continue
      routingDiagnostics.push({
        attachmentIndex,
        representation: 'ocr_text',
        tokenCount: resolved.tokenCount,
        characterCount: resolved.text.length,
        truncated: resolved.truncated,
        ...diagnostics.get(attachmentIndex)
      })
    }
  }

  private emitDiagnostic(event: AttachmentRoutingDiagnostic): void {
    try {
      this.options.onDiagnostic?.(event)
    } catch {
      // Diagnostics never influence attachment routing.
    }
  }
}

function buildPreparationSummary(input: {
  content: SendMessageInput
  files: MessageFile[]
  issues: AttachmentPreparationIssue[]
  supportsVision: boolean
}): AttachmentPreparationSummary {
  if (input.issues.length === 0) {
    return { status: 'ready', issues: [], suggestedActions: [] }
  }

  const fallbackRequested = input.content.attachmentFallbackPolicy === 'send_without_image_content'
  const hasUsefulContent =
    input.content.text.trim().length > 0 ||
    input.files.some((file) => {
      const resolved = getAttachmentResolvedRepresentation(file)
      if (resolved?.kind === 'ocr_text') return resolved.text.trim().length > 0
      if (resolved?.kind === 'image') return input.supportsVision
      return !isImageAttachment(file) && Boolean(file.content?.trim())
    })

  if (fallbackRequested || hasUsefulContent) {
    return { status: 'degraded', issues: input.issues, suggestedActions: [] }
  }

  const suggestedActions: AttachmentPreparationAction[] = ['send_without_image_content']
  if (!input.supportsVision) suggestedActions.unshift('switch_to_vision_model')
  if (
    input.files.some((file) => {
      const resolved = getAttachmentResolvedRepresentation(file)
      return resolved?.kind === 'unavailable' && isRetryableReason(resolved.reason)
    })
  ) {
    suggestedActions.push('retry')
  }
  return { status: 'needs_user_action', issues: input.issues, suggestedActions }
}

function applyTurnOcrTextBudget(files: MessageFile[]): void {
  const ocrFiles = files.flatMap((file) => {
    const resolved = getAttachmentResolvedRepresentation(file)
    return resolved?.kind === 'ocr_text' ? [{ file, resolved }] : []
  })
  let remainingTokens = MAX_TURN_OCR_TEXT_TOKENS
  for (let index = 0; index < ocrFiles.length; index += 1) {
    const item = ocrFiles[index]
    const remainingItems = ocrFiles.length - index
    const budget = Math.min(
      ATTACHMENT_OCR_MAX_TOKENS,
      Math.max(0, Math.floor(remainingTokens / remainingItems))
    )
    const limited = truncateOcrText(item.resolved.text, budget)
    item.file.resolvedRepresentation = {
      kind: 'ocr_text',
      text: limited.text,
      tokenCount: limited.tokenCount,
      truncated: item.resolved.truncated || limited.truncated
    }
    remainingTokens = Math.max(0, remainingTokens - limited.tokenCount)
  }
}

function prepareLlmFriendlyImagePayload(file: MessageFile): boolean {
  const primary = normalizeLlmFriendlyImageDataUrl(file.content)
  if (primary) {
    file.content = primary
    return true
  }
  const thumbnail = normalizeLlmFriendlyImageDataUrl(file.thumbnail)
  if (!thumbnail) return false

  // The synchronous context builder prefers any data:image content over the thumbnail. Remove an
  // invalid primary payload from this routed copy so its valid thumbnail is actually selected.
  file.content = undefined
  file.thumbnail = thumbnail
  return true
}

function normalizeLlmFriendlyImageDataUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized.startsWith('data:image/')) return null
  const match = /^(data:image\/[a-z0-9.+-]+;base64,)([\s\S]+)$/i.exec(normalized)
  if (!match) return null
  const payload = match[2].replace(/\s/g, '')
  const isValid =
    payload.length > 0 && payload.length % 4 !== 1 && /^[a-z0-9+/]*={0,2}$/i.test(payload)
  return isValid ? `${match[1]}${payload}` : null
}

function mapExtractionFailure(error: unknown): AttachmentUnavailableReason {
  if (error instanceof ImagePreprocessingError) {
    switch (error.code) {
      case 'image_dimensions_exceeded':
      case 'invalid_image_dimensions':
        return 'image_dimensions_exceeded'
      case 'input_too_large':
        return 'image_too_large'
      case 'unsupported_format':
        return 'unsupported_image_format'
      default:
        return 'ocr_failed'
    }
  }
  if (error instanceof ImageTextExtractionError) {
    switch (error.code) {
      case 'batch_image_limit_exceeded':
        return 'image_limit_exceeded'
      case 'batch_source_bytes_exceeded':
        return 'turn_image_bytes_exceeded'
      case 'queue_full':
        return 'ocr_queue_full'
      default:
        return 'ocr_failed'
    }
  }
  if (error instanceof LightOcrProcessHostError && error.code === 'queue_full') {
    return 'ocr_queue_full'
  }
  return 'ocr_failed'
}

function throwIfCancelled(error: unknown, signal?: AbortSignal): void {
  if (
    signal?.aborted ||
    (error instanceof ImageTextExtractionError && error.code === 'cancelled') ||
    (error instanceof ImagePreprocessingError && error.code === 'cancelled') ||
    (error instanceof Error && error.name === 'AbortError')
  ) {
    throw abortError(signal)
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal)
}

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason
  const error = new Error('Attachment preparation was cancelled')
  error.name = 'AbortError'
  return error
}

function isRetryableReason(reason: AttachmentUnavailableReason): boolean {
  return reason === 'ocr_failed' || reason === 'ocr_queue_full' || reason === 'ocr_empty'
}
