import { BrowserWindow } from 'electron'
import { performance } from 'node:perf_hooks'
import sharp from 'sharp'
import { DEEPCHAT_EVENT_CHANNEL } from '@shared/contracts/channels'
import { createDeepchatEventEnvelope } from '@shared/contracts/events'
import logger from '@shared/logger'
import type {
  ComputerUsePreviewMode,
  ComputerUsePreviewModeResult,
  ComputerUsePreviewSurface
} from '@shared/types/computerUse'
import type { IComputerUsePreviewPresenter, IWindowPresenter } from '@shared/types/desktop'
import type { MCPImageContent, MCPToolResponse } from '@shared/types/mcp'
import type { ComputerUsePreviewCall, ComputerUsePreviewObserver } from '@/mcp/toolManager'
import {
  AgentPreviewCoordinator,
  type AgentPreviewAction,
  type AgentPreviewTarget
} from '@/desktop/preview/AgentPreviewCoordinator'

type ComputerUseFrame = {
  data: Buffer
  width: number
  height: number
  sequence: number
  timestamp: number
}

type PendingSnapshot = {
  call: ComputerUsePreviewCall
  image: MCPImageContent
  epoch: number
  claimSequence: number
}

type ComputerUsePreviewState = {
  sessionId: string
  mode: ComputerUsePreviewMode
  hostWindowId: number | null
  hostClosedListener: (() => void) | null
  runId: string | null
  toolCallId: string | null
  toolCallEpoch: number
  pid: number | null
  targetWindowId: number | null
  epoch: number
  claimSequence: number
  dismissedRunId: string | null
  surface: ComputerUsePreviewSurface
  frame: ComputerUseFrame | null
  nextFrameSequence: number
  transformActive: boolean
  pendingSnapshot: PendingSnapshot | null
}

const FRAME_MAX_WIDTH = 480
const FRAME_MAX_HEIGHT = 300
const FRAME_MAX_BYTES = 512 * 1024
const INPUT_MAX_BYTES = 16 * 1024 * 1024
const INPUT_MAX_DIMENSION = 8192
const INPUT_MAX_PIXELS = INPUT_MAX_DIMENSION * INPUT_MAX_DIMENSION
const JPEG_QUALITY = 72
const SLOW_TRANSFORM_WARNING_MS = 150
const WARNING_INTERVAL_MS = 60_000
const SUPPORTED_MIME_TYPES = new Set(['image/jpeg', 'image/png'])

export class ComputerUsePreviewPresenter
  implements IComputerUsePreviewPresenter, ComputerUsePreviewObserver
{
  private readonly states = new Map<string, ComputerUsePreviewState>()
  private readonly unregisterPreviewHandler: () => void
  private lastValidationWarningAt = 0
  private lastSlowTransformWarningAt = 0

  constructor(
    private readonly windowPresenter: IWindowPresenter,
    private readonly previewCoordinator: AgentPreviewCoordinator
  ) {
    this.unregisterPreviewHandler = previewCoordinator.register('computer-use', (action, target) =>
      this.handlePreviewAction(action, target)
    )
  }

  shouldCaptureAfterClick(call: ComputerUsePreviewCall): boolean {
    const state = this.states.get(call.conversationId)
    if (state?.hostWindowId != null) {
      const host = BrowserWindow.fromId(state.hostWindowId)
      if (!host || host.isDestroyed()) {
        this.stopState(state)
        return false
      }
    }
    const pid = this.readPositiveInteger(call.args.pid)
    const targetWindowId = this.readPositiveInteger(call.args.window_id)
    return Boolean(
      call.toolName === 'click' &&
      state &&
      pid != null &&
      targetWindowId != null &&
      state.mode === 'eligible' &&
      state.hostWindowId != null &&
      state.runId === call.runId &&
      state.pid === pid &&
      state.targetWindowId === targetWindowId &&
      state.dismissedRunId !== call.runId
    )
  }

  started(call: ComputerUsePreviewCall): void {
    if (call.toolName !== 'get_window_state') {
      return
    }
    const pid = this.readPositiveInteger(call.args.pid)
    const targetWindowId = this.readPositiveInteger(call.args.window_id)
    if (pid == null || targetWindowId == null) {
      return
    }

    const state = this.states.get(call.conversationId) ?? this.createState(call.conversationId)
    const targetChanged =
      state.runId !== call.runId || state.pid !== pid || state.targetWindowId !== targetWindowId
    if (targetChanged) {
      if (state.runId) {
        this.previewCoordinator.removeTarget({
          source: 'computer-use',
          sessionId: state.sessionId,
          runId: state.runId
        })
      }
      state.epoch += 1
      state.frame = null
      state.pendingSnapshot = null
      state.surface = 'none'
      if (state.runId !== call.runId) {
        state.dismissedRunId = null
      }
    }

    state.runId = call.runId
    state.toolCallId = call.toolCallId
    state.toolCallEpoch = state.epoch
    state.pid = pid
    state.targetWindowId = targetWindowId
    state.claimSequence = this.previewCoordinator.claim({
      source: 'computer-use',
      sessionId: state.sessionId,
      runId: call.runId
    })

    if (state.mode === 'eligible') {
      if (targetChanged || state.surface === 'none') {
        this.presentCurrent(state)
      } else {
        this.prepareCurrent(state)
      }
    }
  }

  completed(call: ComputerUsePreviewCall, result: MCPToolResponse): void {
    const state = this.states.get(call.conversationId)
    if (
      !state ||
      result.isError === true ||
      state.dismissedRunId === call.runId ||
      state.runId !== call.runId ||
      state.toolCallId !== call.toolCallId ||
      state.toolCallEpoch !== state.epoch
    ) {
      return
    }

    const image = this.readInlineImage(result)
    if (!image) {
      return
    }
    this.enqueueSnapshot(state, {
      call,
      image,
      epoch: state.epoch,
      claimSequence: state.claimSequence
    })
  }

  failed(_call: ComputerUsePreviewCall, _error: unknown): void {
    // Keep the last valid frame for the same run and target.
  }

  async setPreviewMode(
    sessionId: string,
    mode: ComputerUsePreviewMode,
    hostWindowId?: number
  ): Promise<ComputerUsePreviewModeResult> {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
      return { updated: false, surface: 'none' }
    }

    if (mode === 'stopped') {
      const state = this.states.get(normalizedSessionId)
      if (
        !state ||
        (hostWindowId != null && state.hostWindowId != null && state.hostWindowId !== hostWindowId)
      ) {
        return { updated: false, surface: 'none' }
      }
      this.stopState(state)
      return { updated: true, surface: 'none' }
    }

    const host = hostWindowId == null ? null : BrowserWindow.fromId(hostWindowId)
    if (!host || host.isDestroyed()) {
      const state = this.states.get(normalizedSessionId)
      if (state && (state.hostWindowId == null || state.hostWindowId === hostWindowId)) {
        this.stopState(state)
      }
      return { updated: false, surface: 'none' }
    }

    this.stopOtherSessionsForHost(normalizedSessionId, host.id)
    await this.previewCoordinator.initialize()
    if (host.isDestroyed()) {
      const state = this.states.get(normalizedSessionId)
      if (state && (state.hostWindowId == null || state.hostWindowId === host.id)) {
        this.stopState(state)
      }
      return { updated: false, surface: 'none' }
    }
    const state = this.states.get(normalizedSessionId) ?? this.createState(normalizedSessionId)
    this.bindHost(state, host)
    state.mode = mode

    if (mode === 'suspended') {
      this.previewCoordinator.hide({
        source: 'computer-use',
        sessionId: normalizedSessionId,
        ...(state.runId ? { runId: state.runId } : {})
      })
      this.setSurface(state, 'none')
      return { updated: true, surface: 'none' }
    }

    const surface = this.presentCurrent(state, true)
    return { updated: true, surface }
  }

  dismissPreview(sessionId: string, runId: string): boolean {
    const state = this.states.get(sessionId)
    if (!state || state.runId !== runId) {
      return false
    }

    const dismissed = this.previewCoordinator.dismiss({
      source: 'computer-use',
      sessionId,
      runId
    })
    if (dismissed) {
      state.dismissedRunId = runId
      state.epoch += 1
      state.frame = null
      state.pendingSnapshot = null
      this.setSurface(state, 'none')
    }
    return dismissed
  }

  shutdown(): void {
    for (const state of this.states.values()) {
      this.stopState(state)
    }
    this.unregisterPreviewHandler()
  }

  private createState(sessionId: string): ComputerUsePreviewState {
    const state: ComputerUsePreviewState = {
      sessionId,
      mode: 'stopped',
      hostWindowId: null,
      hostClosedListener: null,
      runId: null,
      toolCallId: null,
      toolCallEpoch: 0,
      pid: null,
      targetWindowId: null,
      epoch: 0,
      claimSequence: 0,
      dismissedRunId: null,
      surface: 'none',
      frame: null,
      nextFrameSequence: 0,
      transformActive: false,
      pendingSnapshot: null
    }
    this.states.set(sessionId, state)
    return state
  }

  private bindHost(state: ComputerUsePreviewState, host: BrowserWindow): void {
    if (state.hostWindowId === host.id && state.hostClosedListener) {
      return
    }
    this.unbindHost(state)
    const closed = () => {
      if (state.hostClosedListener !== closed) {
        return
      }
      state.hostClosedListener = null
      this.stopState(state)
    }
    state.hostWindowId = host.id
    state.hostClosedListener = closed
    host.once('closed', closed)
  }

  private unbindHost(state: ComputerUsePreviewState): void {
    const host = state.hostWindowId == null ? null : BrowserWindow.fromId(state.hostWindowId)
    if (host && state.hostClosedListener) {
      host.removeListener('closed', state.hostClosedListener)
    }
    state.hostWindowId = null
    state.hostClosedListener = null
  }

  private stopState(state: ComputerUsePreviewState): void {
    if (this.states.get(state.sessionId) !== state) {
      return
    }
    state.epoch += 1
    state.mode = 'stopped'
    state.frame = null
    state.pendingSnapshot = null
    if (state.runId) {
      this.previewCoordinator.releaseClaim({
        source: 'computer-use',
        sessionId: state.sessionId,
        runId: state.runId
      })
    }
    this.unbindHost(state)
    this.states.delete(state.sessionId)
  }

  private readPositiveInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
  }

  private readInlineImage(result: MCPToolResponse): MCPImageContent | null {
    if (!Array.isArray(result.content)) {
      return null
    }
    for (const item of result.content) {
      if (
        item.type === 'image' &&
        typeof item.data === 'string' &&
        typeof item.mimeType === 'string' &&
        SUPPORTED_MIME_TYPES.has(item.mimeType.toLowerCase())
      ) {
        return item
      }
    }
    return null
  }

  private enqueueSnapshot(state: ComputerUsePreviewState, snapshot: PendingSnapshot): void {
    if (state.transformActive) {
      state.pendingSnapshot = snapshot
      return
    }
    state.transformActive = true
    void this.transformSnapshot(state, snapshot).finally(() => {
      const current = this.states.get(snapshot.call.conversationId)
      if (current !== state) {
        return
      }
      state.transformActive = false
      const pending = state.pendingSnapshot
      state.pendingSnapshot = null
      if (pending) {
        this.enqueueSnapshot(state, pending)
      }
    })
  }

  private async transformSnapshot(
    owner: ComputerUsePreviewState,
    snapshot: PendingSnapshot
  ): Promise<void> {
    const startedAt = performance.now()
    try {
      const source = this.decodeBase64(snapshot.image.data)
      const image = sharp(source, {
        failOn: 'warning',
        limitInputPixels: INPUT_MAX_PIXELS
      })
      const metadata = await image.metadata()
      const mimeType = snapshot.image.mimeType.toLowerCase()
      const expectedFormat = mimeType === 'image/png' ? 'png' : 'jpeg'
      if (
        metadata.format !== expectedFormat ||
        !metadata.width ||
        !metadata.height ||
        metadata.width > INPUT_MAX_DIMENSION ||
        metadata.height > INPUT_MAX_DIMENSION
      ) {
        throw new Error('unsupported image metadata')
      }

      const transformed = await image
        .resize({
          width: FRAME_MAX_WIDTH,
          height: FRAME_MAX_HEIGHT,
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer({ resolveWithObject: true })
      if (
        transformed.data.byteLength === 0 ||
        transformed.data.byteLength > FRAME_MAX_BYTES ||
        transformed.info.width <= 0 ||
        transformed.info.height <= 0
      ) {
        throw new Error('invalid transformed image')
      }

      const state = this.states.get(snapshot.call.conversationId)
      if (
        state !== owner ||
        state.runId !== snapshot.call.runId ||
        state.toolCallId !== snapshot.call.toolCallId ||
        state.epoch !== snapshot.epoch ||
        state.claimSequence !== snapshot.claimSequence ||
        state.dismissedRunId === snapshot.call.runId
      ) {
        return
      }

      state.nextFrameSequence += 1
      state.frame = {
        data: transformed.data,
        width: transformed.info.width,
        height: transformed.info.height,
        sequence: state.nextFrameSequence,
        timestamp: Date.now()
      }
      if (state.mode === 'eligible') {
        this.presentCurrent(state)
      }
    } catch (error) {
      this.warnValidation(snapshot.call, error)
    } finally {
      const durationMs = performance.now() - startedAt
      if (
        durationMs > SLOW_TRANSFORM_WARNING_MS &&
        Date.now() - this.lastSlowTransformWarningAt >= WARNING_INTERVAL_MS
      ) {
        this.lastSlowTransformWarningAt = Date.now()
        logger.warn('[ComputerUsePreview] Slow snapshot transform', {
          durationMs: Math.round(durationMs)
        })
      }
    }
  }

  private decodeBase64(data: string): Buffer {
    const normalized = data.trim()
    const maxBase64Length = Math.ceil((INPUT_MAX_BYTES * 4) / 3) + 4
    if (
      !normalized ||
      normalized.length > maxBase64Length ||
      normalized.length % 4 === 1 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
    ) {
      throw new Error('invalid base64 image')
    }
    const buffer = Buffer.from(normalized, 'base64')
    if (buffer.byteLength === 0 || buffer.byteLength > INPUT_MAX_BYTES) {
      throw new Error('image input exceeds limit')
    }
    return buffer
  }

  private prepareCurrent(
    state: ComputerUsePreviewState,
    announceSurface = false
  ): ComputerUsePreviewSurface {
    const target = this.previewTarget(state)
    if (!target || state.mode !== 'eligible') {
      return this.setSurface(state, 'none', announceSurface)
    }
    const host = state.hostWindowId == null ? null : BrowserWindow.fromId(state.hostWindowId)
    if (!host || host.isDestroyed()) {
      this.stopState(state)
      return 'none'
    }
    return this.setSurface(state, this.previewCoordinator.prepare(target, host), announceSurface)
  }

  private presentCurrent(
    state: ComputerUsePreviewState,
    announceSurface = false
  ): ComputerUsePreviewSurface {
    const surface = this.prepareCurrent(state, announceSurface)
    const frame = state.frame
    const target = this.previewTarget(state)
    if (surface === 'none' || !frame || !target || state.hostWindowId == null) {
      return surface
    }

    if (surface === 'native-overlay') {
      if (this.previewCoordinator.present(target, frame.data)) {
        return surface
      }
      const host = BrowserWindow.fromId(state.hostWindowId)
      if (!host || host.isDestroyed()) {
        return this.setSurface(state, 'none')
      }
      const fallbackSurface = this.previewCoordinator.prepare(target, host)
      this.setSurface(state, fallbackSurface)
      if (fallbackSurface !== 'renderer-canvas') {
        return fallbackSurface
      }
    }

    this.windowPresenter.sendToWindow(
      state.hostWindowId,
      DEEPCHAT_EVENT_CHANNEL,
      createDeepchatEventEnvelope('computerUse.preview.frame', {
        sessionId: state.sessionId,
        runId: target.runId,
        epoch: state.epoch,
        sequence: frame.sequence,
        width: frame.width,
        height: frame.height,
        mimeType: 'image/jpeg',
        data: frame.data,
        timestamp: frame.timestamp
      })
    )
    return state.surface
  }

  private previewTarget(state: ComputerUsePreviewState): AgentPreviewTarget | null {
    if (
      state.hostWindowId == null ||
      !state.runId ||
      state.pid == null ||
      state.targetWindowId == null ||
      state.claimSequence <= 0 ||
      state.dismissedRunId === state.runId
    ) {
      return null
    }
    return {
      source: 'computer-use',
      windowId: state.hostWindowId,
      sessionId: state.sessionId,
      runId: state.runId,
      epoch: state.epoch,
      claimSequence: state.claimSequence
    }
  }

  private setSurface(
    state: ComputerUsePreviewState,
    surface: ComputerUsePreviewSurface,
    forceEvent = false
  ): ComputerUsePreviewSurface {
    if (state.surface === surface && !forceEvent) {
      return surface
    }
    state.surface = surface
    if (state.hostWindowId != null && state.runId) {
      this.windowPresenter.sendToWindow(
        state.hostWindowId,
        DEEPCHAT_EVENT_CHANNEL,
        createDeepchatEventEnvelope('computerUse.preview.surface.changed', {
          windowId: state.hostWindowId,
          sessionId: state.sessionId,
          runId: state.runId,
          epoch: state.epoch,
          surface,
          version: Date.now()
        })
      )
    }
    return surface
  }

  private stopOtherSessionsForHost(sessionId: string, hostWindowId: number): void {
    for (const [otherSessionId, state] of this.states) {
      if (otherSessionId === sessionId || state.hostWindowId !== hostWindowId) {
        continue
      }
      this.stopState(state)
    }
  }

  private handlePreviewAction(action: AgentPreviewAction, target: AgentPreviewTarget): void {
    if (target.source !== 'computer-use') {
      return
    }
    const state = this.states.get(target.sessionId)
    if (
      !state ||
      state.runId !== target.runId ||
      state.epoch !== target.epoch ||
      state.claimSequence !== target.claimSequence
    ) {
      return
    }

    if (action === 'dismiss') {
      state.dismissedRunId = target.runId
      state.epoch += 1
      state.frame = null
      state.pendingSnapshot = null
    }
    this.setSurface(state, 'none')
  }

  private warnValidation(call: ComputerUsePreviewCall, error: unknown): void {
    if (Date.now() - this.lastValidationWarningAt < WARNING_INTERVAL_MS) {
      return
    }
    this.lastValidationWarningAt = Date.now()
    logger.warn('[ComputerUsePreview] Snapshot rejected', {
      toolCallId: call.toolCallId,
      reason: error instanceof Error ? error.message : String(error)
    })
  }
}
