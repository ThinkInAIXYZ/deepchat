import { readFile } from 'node:fs/promises'
import {
  AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES,
  AUDIO_TRANSCRIPTION_MAX_TEXT_CHARACTERS,
  AudioInputMimeTypeSchema,
  AudioTranscriptionOutputSchema,
  audioTranscribeArtifactRoute,
  audioTranscribeUploadRoute,
  type AudioTranscriptionArtifactInput,
  type AudioTranscriptionOutput,
  type AudioTranscriptionUploadInput
} from '@shared/contracts/routes'
import type { ProviderRuntime } from '@/provider'
import type { ProviderSettingsPort } from '@/provider/settings'
import type { CliRouteCaller } from '@/routes/routeRegistry'
import type { ArtifactSpool } from './artifactSpool'
import { CliRequestError } from './errors'
import type { CliUploadedInputFile } from './server'

const MAX_ACTIVE_TRANSCRIPTIONS = 2

type AudioTranscriptionProviderSettings = Pick<
  ProviderSettingsPort,
  'getProviderById' | 'getModelStatus' | 'isKnownModel'
>

type AudioTranscriptionProviderRuntime = Pick<ProviderRuntime, 'transcribeAudioStandalone'>

export type CliAudioTranscriptionServiceOptions = Readonly<{
  providerSettings: AudioTranscriptionProviderSettings
  providerRuntime: AudioTranscriptionProviderRuntime
  artifactSpool: ArtifactSpool
  now?: () => number
  log?: Pick<Console, 'warn'>
}>

function truncateAtCodePoint(value: string, maxCharacters: number): string {
  let end = Math.min(value.length, maxCharacters)
  const code = value.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return value.slice(0, end)
}

export class CliAudioTranscriptionService {
  private readonly now: () => number
  private readonly log: Pick<Console, 'warn'>
  private activeTranscriptions = 0

  constructor(private readonly options: CliAudioTranscriptionServiceOptions) {
    this.now = options.now ?? Date.now
    this.log = options.log ?? console
  }

  handlesRpc(method: string): boolean {
    return method === audioTranscribeArtifactRoute.name
  }

  handlesUpload(method: string): boolean {
    return method === audioTranscribeUploadRoute.name
  }

  async dispatchRpc(
    method: string,
    rawInput: unknown,
    caller: CliRouteCaller,
    signal: AbortSignal
  ): Promise<unknown> {
    if (!this.handlesRpc(method)) {
      throw new CliRequestError('not_found', 'Audio transcription method is not implemented', {
        httpStatus: 404
      })
    }
    return await this.transcribeArtifact(
      audioTranscribeArtifactRoute.input.parse(rawInput),
      caller,
      signal
    )
  }

  async dispatchUpload(
    method: string,
    rawInput: unknown,
    upload: CliUploadedInputFile,
    caller: CliRouteCaller,
    signal: AbortSignal
  ): Promise<unknown> {
    if (caller.principal !== 'human') {
      throw new CliRequestError('permission_denied', 'Agent callers cannot upload file bytes', {
        httpStatus: 403
      })
    }
    if (!this.handlesUpload(method)) {
      throw new CliRequestError('not_found', 'Audio upload method is not implemented', {
        httpStatus: 404
      })
    }
    return await this.transcribeUpload(
      audioTranscribeUploadRoute.input.parse(rawInput),
      upload,
      signal
    )
  }

  private async transcribeArtifact(
    input: AudioTranscriptionArtifactInput,
    caller: CliRouteCaller,
    signal: AbortSignal
  ): Promise<AudioTranscriptionOutput> {
    return await this.options.artifactSpool.withFile(input.artifactId, caller, async (file) => {
      const mimeType = AudioInputMimeTypeSchema.safeParse(file.metadata.mimeType)
      if (!mimeType.success) {
        throw new CliRequestError('invalid_request', 'Artifact is not an audio input')
      }
      this.assertInputSize(file.metadata.size, 'Audio artifact')
      return await this.transcribeFile(
        input,
        file.path,
        file.metadata.size,
        mimeType.data,
        file.metadata.filename,
        signal
      )
    })
  }

  private async transcribeUpload(
    input: AudioTranscriptionUploadInput,
    upload: CliUploadedInputFile,
    signal: AbortSignal
  ): Promise<AudioTranscriptionOutput> {
    this.assertInputSize(upload.size, 'Audio upload')
    return await this.transcribeFile(
      input,
      upload.path,
      upload.size,
      input.mimeType,
      input.filename,
      signal
    )
  }

  private async transcribeFile(
    input: Pick<AudioTranscriptionUploadInput, 'providerId' | 'modelId'>,
    filePath: string,
    inputBytes: number,
    mimeType: string,
    filename: string | undefined,
    signal: AbortSignal
  ): Promise<AudioTranscriptionOutput> {
    this.requireAvailableModel(input.providerId, input.modelId)
    if (this.activeTranscriptions >= MAX_ACTIVE_TRANSCRIPTIONS) {
      throw new CliRequestError('rate_limited', 'Audio transcription capacity is full', {
        httpStatus: 429,
        retriable: true
      })
    }

    this.activeTranscriptions += 1
    const startedAt = this.now()
    try {
      signal.throwIfAborted()
      const bytes = await readFile(filePath, { signal })
      if (bytes.byteLength !== inputBytes) {
        throw new CliRequestError('unavailable', 'Audio input changed before transcription', {
          httpStatus: 410
        })
      }
      signal.throwIfAborted()
      const transcript = await this.options.providerRuntime.transcribeAudioStandalone(
        input.providerId,
        input.modelId,
        bytes.toString('base64'),
        mimeType,
        filename,
        { signal }
      )
      signal.throwIfAborted()
      const normalized = transcript.trim()
      const truncated = normalized.length > AUDIO_TRANSCRIPTION_MAX_TEXT_CHARACTERS
      return AudioTranscriptionOutputSchema.parse({
        providerId: input.providerId,
        modelId: input.modelId,
        text: truncated
          ? truncateAtCodePoint(normalized, AUDIO_TRANSCRIPTION_MAX_TEXT_CHARACTERS)
          : normalized,
        truncated,
        inputBytes,
        mimeType,
        durationMs: Math.max(0, this.now() - startedAt)
      })
    } catch (error) {
      throw this.normalizeError(error, input, signal)
    } finally {
      this.activeTranscriptions = Math.max(0, this.activeTranscriptions - 1)
    }
  }

  private assertInputSize(size: number, name: string): void {
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new CliRequestError('invalid_request', `${name} is empty or invalid`)
    }
    if (size > AUDIO_TRANSCRIPTION_MAX_INPUT_BYTES) {
      throw new CliRequestError('body_too_large', `${name} exceeds its byte limit`, {
        httpStatus: 413
      })
    }
  }

  private requireAvailableModel(providerId: string, modelId: string): void {
    const provider = this.options.providerSettings.getProviderById(providerId)
    if (!provider?.enable) {
      throw new CliRequestError('not_found', 'Provider is not available', { httpStatus: 404 })
    }
    if (!this.options.providerSettings.isKnownModel(providerId, modelId)) {
      throw new CliRequestError('not_found', 'Model is not available', { httpStatus: 404 })
    }
    if (!this.options.providerSettings.getModelStatus(providerId, modelId)) {
      throw new CliRequestError('conflict', 'Model is disabled', { httpStatus: 409 })
    }
  }

  private normalizeError(
    error: unknown,
    input: Pick<AudioTranscriptionUploadInput, 'providerId' | 'modelId'>,
    signal: AbortSignal
  ): CliRequestError {
    if (error instanceof CliRequestError) return error
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return new CliRequestError('cancelled', 'Audio transcription was cancelled', {
        retriable: true
      })
    }
    this.log.warn('[CLI] Audio transcription failed', {
      providerId: input.providerId,
      modelId: input.modelId,
      failure: { name: error instanceof Error ? error.name : typeof error }
    })
    return new CliRequestError('unavailable', 'Audio transcription failed', {
      httpStatus: 503,
      retriable: true
    })
  }
}
