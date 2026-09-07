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
  isImageAttachment,
  isPdfAttachment,
  normalizeAttachmentRepresentationPreferenceForFile,
  normalizePdfEmbeddedTextCoverage
} from '@shared/utils/attachmentRepresentation'
import {
  ATTACHMENT_OCR_MAX_TOKENS,
  ATTACHMENT_PDF_OCR_MAX_TOKENS,
  ATTACHMENT_PREPARATION_MAX_ISSUES,
  PDF_AUTO_EMBEDDED_COVERAGE_PERCENT,
  PDF_ROUTING_REVISION,
  type AttachmentDocumentOcrSnapshot,
  type PdfEmbeddedTextCoverage
} from '@shared/types/attachment'
import { ImagePreprocessingError } from './imagePreprocessor'
import {
  ImageTextExtractionError,
  truncateOcrText,
  type ImageTextExtractionBatchItem,
  type ImageTextExtractionInput,
  type ImageTextExtractionPort
} from './imageTextExtractionService'
import {
  DocumentTextExtractionError,
  type DocumentTextExtractionPort,
  type DocumentTextExtractionResult
} from './documentTextExtractionService'
import { truncateDocumentOcrText } from './documentOcrArtifact'
import type { LightOcrBackendPreference } from './lightOcrProtocol'
import { LightOcrProcessHostError } from './lightOcrProcessHost'
import type { OcrRuntimeAvailability } from './ocrRuntimeAssetResolver'

const MAX_OCR_IMAGES_PER_TURN = 8
const MAX_OCR_DOCUMENTS_PER_TURN = 1
const MAX_TURN_OCR_TEXT_TOKENS = 16_000

export interface AttachmentOcrRuntimePort
  extends ImageTextExtractionPort, DocumentTextExtractionPort {
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
  representation: 'image' | 'embedded_text' | 'ocr_text' | 'unavailable'
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
  reusePreparedAttachmentRepresentations?: boolean
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
    const imageCandidates: OcrCandidate[] = []
    const documentCandidates: OcrCandidate[] = []
    const routingDiagnostics: AttachmentRoutingDiagnostic[] = []
    const ocrDiagnostics = new Map<number, OcrDiagnosticContext>()
    const automaticOcrEnabled = this.options.getAutomaticOcrEnabled()

    for (let attachmentIndex = 0; attachmentIndex < files.length; attachmentIndex += 1) {
      const sourceFile = input.content.files?.[attachmentIndex]
      const file = files[attachmentIndex]
      if (!sourceFile) continue
      const imageAttachment = isImageAttachment(sourceFile)
      const pdfAttachment = isPdfAttachment(sourceFile)
      file.pdfTextCoverage = pdfAttachment
        ? normalizePdfEmbeddedTextCoverage(sourceFile.pdfTextCoverage)
        : undefined
      if (!imageAttachment && !pdfAttachment) continue
      if (sourceFile.requestedRepresentation) {
        const contextualPreference = normalizeAttachmentRepresentationPreferenceForFile(
          sourceFile,
          sourceFile.requestedRepresentation
        )
        if (contextualPreference !== sourceFile.requestedRepresentation) {
          file.requestedRepresentation = contextualPreference
        }
      }

      if (input.content.attachmentFallbackPolicy === 'send_without_image_content') {
        this.markUnavailable(
          file,
          attachmentIndex,
          pdfAttachment ? 'user_skipped_attachment_content' : 'user_skipped_image_content',
          issues,
          routingDiagnostics
        )
        continue
      }

      const existing = getAttachmentResolvedRepresentation(sourceFile)
      if (
        (input.preserveResolvedRepresentations || input.reusePreparedAttachmentRepresentations) &&
        existing &&
        this.preserveResolvedRepresentation({
          file,
          existing,
          attachmentIndex,
          attachmentKind: pdfAttachment ? 'pdf' : 'image',
          supportsVision: input.supportsVision,
          issues,
          routingDiagnostics,
          ocrDiagnostics
        })
      ) {
        continue
      }

      if (pdfAttachment) {
        const coverage = file.pdfTextCoverage
        const preference = normalizeAttachmentRepresentationPreferenceForFile(
          file,
          file.requestedRepresentation
        )

        // Retrying a legacy sent message must reuse its persisted body instead of opening the
        // original path or silently changing representation under a historical turn.
        if (input.preserveResolvedRepresentations && !existing) {
          if (hasUsableEmbeddedPdfText(file)) {
            file.resolvedRepresentation = { kind: 'embedded_text' }
            routingDiagnostics.push({ attachmentIndex, representation: 'embedded_text' })
          } else {
            this.markUnavailable(
              file,
              attachmentIndex,
              'pdf_text_unavailable',
              issues,
              routingDiagnostics
            )
          }
          continue
        }

        if (preference === 'embedded_text') {
          if (coverage?.hasEmbeddedText && hasUsableEmbeddedPdfText(file)) {
            file.resolvedRepresentation = { kind: 'embedded_text' }
            routingDiagnostics.push({ attachmentIndex, representation: 'embedded_text' })
          } else {
            this.markUnavailable(
              file,
              attachmentIndex,
              'pdf_text_unavailable',
              issues,
              routingDiagnostics
            )
          }
          continue
        }

        if (
          preference === 'auto' &&
          shouldUseEmbeddedPdfText(coverage) &&
          hasUsableEmbeddedPdfText(file)
        ) {
          file.resolvedRepresentation = { kind: 'embedded_text' }
          routingDiagnostics.push({ attachmentIndex, representation: 'embedded_text' })
          continue
        }

        if (preference === 'auto' && !automaticOcrEnabled) {
          this.markUnavailable(
            file,
            attachmentIndex,
            'automatic_ocr_disabled',
            issues,
            routingDiagnostics
          )
          continue
        }

        documentCandidates.push({ attachmentIndex, file })
        continue
      }

      const preference = normalizeAttachmentRepresentationPreferenceForFile(
        file,
        file.requestedRepresentation
      )
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

      imageCandidates.push({ attachmentIndex, file })
    }

    if (imageCandidates.length > 0 || documentCandidates.length > 0) {
      await this.resolveOcrCandidates(
        imageCandidates,
        documentCandidates,
        issues,
        routingDiagnostics,
        ocrDiagnostics,
        input.signal
      )
    }
    throwIfAborted(input.signal)
    applyTurnOcrTextBudget(files, issues)
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
    imageCandidates: OcrCandidate[],
    documentCandidates: OcrCandidate[],
    issues: AttachmentPreparationIssue[],
    routingDiagnostics: AttachmentRoutingDiagnostic[],
    ocrDiagnostics: Map<number, OcrDiagnosticContext>,
    signal?: AbortSignal
  ): Promise<void> {
    const processableImages = imageCandidates.slice(0, MAX_OCR_IMAGES_PER_TURN)
    for (const candidate of imageCandidates.slice(MAX_OCR_IMAGES_PER_TURN)) {
      this.markUnavailable(
        candidate.file,
        candidate.attachmentIndex,
        'image_limit_exceeded',
        issues,
        routingDiagnostics
      )
    }
    const processableDocuments = documentCandidates.slice(0, MAX_OCR_DOCUMENTS_PER_TURN)
    for (const candidate of documentCandidates.slice(MAX_OCR_DOCUMENTS_PER_TURN)) {
      this.markUnavailable(
        candidate.file,
        candidate.attachmentIndex,
        'document_limit_exceeded',
        issues,
        routingDiagnostics
      )
    }

    const availability = await this.options.extraction.getAvailability()
    throwIfAborted(signal)
    if (availability.status === 'unavailable') {
      for (const candidate of [...processableImages, ...processableDocuments]) {
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
    await this.resolveImageOcrCandidates(
      processableImages,
      backend,
      maxFileSize,
      issues,
      routingDiagnostics,
      ocrDiagnostics,
      signal
    )
    await this.resolveDocumentOcrCandidates(
      processableDocuments,
      backend,
      maxFileSize,
      issues,
      routingDiagnostics,
      ocrDiagnostics,
      signal
    )
  }

  private async resolveImageOcrCandidates(
    candidates: OcrCandidate[],
    backend: LightOcrBackendPreference,
    maxFileSize: number,
    issues: AttachmentPreparationIssue[],
    routingDiagnostics: AttachmentRoutingDiagnostic[],
    ocrDiagnostics: Map<number, OcrDiagnosticContext>,
    signal?: AbortSignal
  ): Promise<void> {
    if (candidates.length === 0) return
    let results: ImageTextExtractionBatchItem[]
    try {
      results = await this.options.extraction.extractBatch(
        candidates.map(
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
      for (const candidate of candidates) {
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

    for (let resultIndex = 0; resultIndex < candidates.length; resultIndex += 1) {
      const candidate = candidates[resultIndex]
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

  private async resolveDocumentOcrCandidates(
    candidates: OcrCandidate[],
    backend: LightOcrBackendPreference,
    maxFileSize: number,
    issues: AttachmentPreparationIssue[],
    routingDiagnostics: AttachmentRoutingDiagnostic[],
    ocrDiagnostics: Map<number, OcrDiagnosticContext>,
    signal?: AbortSignal
  ): Promise<void> {
    for (const candidate of candidates) {
      let result: DocumentTextExtractionResult
      try {
        result = await this.options.extraction.extractDocument({
          filePath: candidate.file.path,
          maxFileSize,
          backend,
          sourcePageCountHint: candidate.file.pdfTextCoverage?.pageCount,
          generationTokenLimit: ATTACHMENT_PDF_OCR_MAX_TOKENS,
          priority: 'interactive',
          signal
        })
      } catch (error) {
        throwIfCancelled(error, signal)
        this.markUnavailable(
          candidate.file,
          candidate.attachmentIndex,
          mapDocumentExtractionFailure(error),
          issues,
          routingDiagnostics
        )
        continue
      }

      if (!result.text.trim() || result.tokenCount <= 0 || result.pageSpans.length === 0) {
        this.markUnavailable(
          candidate.file,
          candidate.attachmentIndex,
          result.artifactTermination === 'resource_limited' ? 'ocr_resource_limited' : 'ocr_empty',
          issues,
          routingDiagnostics
        )
        continue
      }

      const document = buildDocumentOcrSnapshot(result, candidate.file.pdfTextCoverage)
      candidate.file.resolvedRepresentation = {
        kind: 'ocr_text',
        text: result.text,
        tokenCount: result.tokenCount,
        truncated:
          result.generationOutputLimitReached || result.artifactTermination === 'resource_limited',
        document
      }
      if (result.artifactTermination === 'resource_limited') {
        this.appendIssue(candidate.attachmentIndex, 'ocr_resource_limited', issues)
      }
      ocrDiagnostics.set(candidate.attachmentIndex, {
        ...(result.artifactTermination === 'resource_limited'
          ? { reason: 'ocr_resource_limited' as const }
          : {}),
        cacheHit: result.cacheHit,
        strategy: result.engine.strategy,
        detectionProviderChain: [...result.engine.detection.actualProviderChain],
        detectionPrecision: result.engine.detection.precision,
        recognitionProviderChain: [...result.engine.recognition.actualProviderChain],
        recognitionPrecision: result.engine.recognition.precision,
        durationMs: result.timingMs.total
      })
    }
  }

  private appendIssue(
    attachmentIndex: number,
    reason: AttachmentUnavailableReason,
    issues: AttachmentPreparationIssue[]
  ): void {
    if (issues.length < ATTACHMENT_PREPARATION_MAX_ISSUES) {
      issues.push({ attachmentIndex, reason })
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
    this.appendIssue(attachmentIndex, reason, issues)
    routingDiagnostics.push({ attachmentIndex, representation: 'unavailable', reason })
  }

  private preserveResolvedRepresentation(input: {
    file: MessageFile
    existing: NonNullable<ReturnType<typeof getAttachmentResolvedRepresentation>>
    attachmentIndex: number
    attachmentKind: 'image' | 'pdf'
    supportsVision: boolean
    issues: AttachmentPreparationIssue[]
    routingDiagnostics: AttachmentRoutingDiagnostic[]
    ocrDiagnostics: Map<number, OcrDiagnosticContext>
  }): boolean {
    if (input.existing.kind === 'ocr_text') {
      if (input.attachmentKind === 'pdf' && !input.existing.document) return false
      if (input.attachmentKind === 'image' && input.existing.document) return false
      input.file.resolvedRepresentation = input.existing
      input.ocrDiagnostics.set(input.attachmentIndex, { snapshotReused: true })
      return true
    }

    if (input.existing.kind === 'unavailable') {
      this.markUnavailable(
        input.file,
        input.attachmentIndex,
        input.existing.reason,
        input.issues,
        input.routingDiagnostics
      )
      return true
    }

    if (input.attachmentKind === 'pdf') {
      if (input.existing.kind !== 'embedded_text' || !hasUsableEmbeddedPdfText(input.file)) {
        return false
      }
      input.file.resolvedRepresentation = { kind: 'embedded_text' }
      input.routingDiagnostics.push({
        attachmentIndex: input.attachmentIndex,
        representation: 'embedded_text'
      })
      return true
    }

    if (input.existing.kind !== 'image') return false
    if (!input.supportsVision) {
      this.markUnavailable(
        input.file,
        input.attachmentIndex,
        'requested_image_requires_vision',
        input.issues,
        input.routingDiagnostics
      )
      return true
    }
    if (!prepareLlmFriendlyImagePayload(input.file)) {
      this.markUnavailable(
        input.file,
        input.attachmentIndex,
        'image_payload_unavailable',
        input.issues,
        input.routingDiagnostics
      )
      return true
    }
    input.file.resolvedRepresentation = { kind: 'image' }
    input.routingDiagnostics.push({
      attachmentIndex: input.attachmentIndex,
      representation: 'image'
    })
    return true
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

function hasUsableEmbeddedPdfText(file: MessageFile): boolean {
  return typeof file.content === 'string' && file.content.trim().length > 0
}

function shouldUseEmbeddedPdfText(coverage: PdfEmbeddedTextCoverage | undefined): boolean {
  return Boolean(
    coverage &&
    coverage.routingRevision === PDF_ROUTING_REVISION &&
    coverage.substantivePageCount * 100 >= coverage.pageCount * PDF_AUTO_EMBEDDED_COVERAGE_PERCENT
  )
}

function buildDocumentOcrSnapshot(
  result: DocumentTextExtractionResult,
  embeddedTextCoverage: PdfEmbeddedTextCoverage | undefined
): AttachmentDocumentOcrSnapshot {
  const pageSpans = result.pageSpans.map((span) => ({ ...span }))
  const lastSpan = pageSpans.at(-1)
  if (!lastSpan) {
    throw new Error('Document OCR result has no retained page coverage')
  }
  return {
    pageSpans,
    ...(result.sourcePageCountHint ? { sourcePageCountHint: result.sourcePageCountHint } : {}),
    includedThroughPage: lastSpan.pageNumber,
    includedThroughPageComplete: lastSpan.complete,
    artifactTermination: result.artifactTermination,
    generationOutputLimitReached: result.generationOutputLimitReached,
    ...(embeddedTextCoverage
      ? {
          embeddedTextCoverage: {
            ...embeddedTextCoverage,
            lowTextPageSamples: [...embeddedTextCoverage.lowTextPageSamples]
          }
        }
      : {})
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
      if (resolved?.kind === 'embedded_text') return hasUsableEmbeddedPdfText(file)
      if (resolved?.kind === 'unavailable') return false
      return !isImageAttachment(file) && Boolean(file.content?.trim())
    })

  if (fallbackRequested || hasUsefulContent) {
    return { status: 'degraded', issues: input.issues, suggestedActions: [] }
  }

  const suggestedActions: AttachmentPreparationAction[] = ['send_without_image_content']
  if (
    !input.supportsVision &&
    input.files.some(
      (file) =>
        isImageAttachment(file) && getAttachmentResolvedRepresentation(file)?.kind === 'unavailable'
    )
  ) {
    suggestedActions.unshift('switch_to_vision_model')
  }
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

export function applyTurnOcrTextBudget(
  files: MessageFile[],
  issues: AttachmentPreparationIssue[],
  maxTurnTokens = MAX_TURN_OCR_TEXT_TOKENS
): void {
  const ocrFiles = files.flatMap((file, attachmentIndex) => {
    const resolved = getAttachmentResolvedRepresentation(file)
    return resolved?.kind === 'ocr_text' ? [{ attachmentIndex, file, resolved }] : []
  })
  let remainingTokens = Number.isSafeInteger(maxTurnTokens) && maxTurnTokens > 0 ? maxTurnTokens : 0
  for (let index = 0; index < ocrFiles.length; index += 1) {
    const item = ocrFiles[index]
    const remainingItems = ocrFiles.length - index
    const attachmentLimit = item.resolved.document
      ? ATTACHMENT_PDF_OCR_MAX_TOKENS
      : ATTACHMENT_OCR_MAX_TOKENS
    const budget = Math.min(
      attachmentLimit,
      Math.max(0, Math.floor(remainingTokens / remainingItems))
    )
    if (item.resolved.document) {
      const limited = truncateDocumentOcrText(
        {
          text: item.resolved.text,
          pageSpans: item.resolved.document.pageSpans
        },
        budget
      )
      const lastSpan = limited.pageSpans.at(-1)
      if (!limited.text.trim() || limited.tokenCount <= 0 || !lastSpan) {
        item.file.resolvedRepresentation = {
          kind: 'unavailable',
          reason: 'turn_ocr_budget_exhausted'
        }
        recordTurnBudgetIssue(issues, item.attachmentIndex)
        continue
      }
      const generationOutputLimitReached =
        item.resolved.document.generationOutputLimitReached || limited.truncated
      const document: AttachmentDocumentOcrSnapshot = {
        ...item.resolved.document,
        pageSpans: limited.pageSpans.map((span) => ({ ...span })),
        includedThroughPage: lastSpan.pageNumber,
        includedThroughPageComplete: lastSpan.complete,
        generationOutputLimitReached
      }
      item.file.resolvedRepresentation = {
        kind: 'ocr_text',
        text: limited.text,
        tokenCount: limited.tokenCount,
        truncated:
          generationOutputLimitReached || document.artifactTermination === 'resource_limited',
        document
      }
      remainingTokens = Math.max(0, remainingTokens - limited.tokenCount)
      continue
    }

    const limited = truncateOcrText(item.resolved.text, budget)
    if (!limited.text.trim() || limited.tokenCount <= 0) {
      item.file.resolvedRepresentation = {
        kind: 'unavailable',
        reason: 'turn_ocr_budget_exhausted'
      }
      recordTurnBudgetIssue(issues, item.attachmentIndex)
      continue
    }
    item.file.resolvedRepresentation = {
      kind: 'ocr_text',
      text: limited.text,
      tokenCount: limited.tokenCount,
      truncated: item.resolved.truncated || limited.truncated
    }
    remainingTokens = Math.max(0, remainingTokens - limited.tokenCount)
  }
}

function recordTurnBudgetIssue(
  issues: AttachmentPreparationIssue[],
  attachmentIndex: number
): void {
  const existingIndex = issues.findIndex((issue) => issue.attachmentIndex === attachmentIndex)
  if (existingIndex >= 0) {
    issues[existingIndex] = { attachmentIndex, reason: 'turn_ocr_budget_exhausted' }
    for (let index = issues.length - 1; index > existingIndex; index -= 1) {
      if (issues[index].attachmentIndex === attachmentIndex) issues.splice(index, 1)
    }
    return
  }
  if (issues.length < ATTACHMENT_PREPARATION_MAX_ISSUES) {
    issues.push({ attachmentIndex, reason: 'turn_ocr_budget_exhausted' })
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

function mapDocumentExtractionFailure(error: unknown): AttachmentUnavailableReason {
  if (error instanceof DocumentTextExtractionError) {
    switch (error.code) {
      case 'input_too_large':
        return 'document_too_large'
      case 'queue_full':
        return 'ocr_queue_full'
      default:
        return 'ocr_failed'
    }
  }
  if (error instanceof LightOcrProcessHostError) {
    if (error.code === 'queue_full') return 'ocr_queue_full'
    if (error.code === 'input_too_large') return 'document_too_large'
    if (error.code === 'helper_error' && error.helperCode === 'resource_limit_exceeded') {
      return 'ocr_resource_limited'
    }
  }
  return 'ocr_failed'
}

function throwIfCancelled(error: unknown, signal?: AbortSignal): void {
  if (
    signal?.aborted ||
    (error instanceof DocumentTextExtractionError && error.code === 'cancelled') ||
    (error instanceof ImageTextExtractionError && error.code === 'cancelled') ||
    (error instanceof ImagePreprocessingError && error.code === 'cancelled') ||
    (error instanceof LightOcrProcessHostError && error.code === 'cancelled') ||
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
  return reason === 'ocr_failed' || reason === 'ocr_queue_full'
}
