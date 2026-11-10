import path from 'node:path'
import type { JsonValue } from '@shared/contracts/json'
import type {
  StandaloneImageGenerationResult,
  StandaloneSpeechGenerationResult,
  StandaloneVideoGenerationResult
} from '@shared/types/provider'
import {
  normalizeImageGenerationOptions,
  type ImageGenerationOptions
} from '@shared/imageGenerationSettings'
import {
  resolveVideoGenerationRequestOptions,
  resolveOpenAICompatibleVideoRequestBodyShape,
  type VideoGenerationOptions
} from '@shared/videoGenerationSettings'
import { normalizeTtsSettings, type TtsSettings } from '@shared/ttsSettings'
import type { ProviderSettingsPort } from '@/provider/settings'
import type { DimModelCatalog } from './modelCatalog'
import type { DimModality, DimMediaSubmission, DimMediaTask } from './modality'

interface MediaOptions {
  settings: Pick<ProviderSettingsPort, 'getModelConfig'> &
    Partial<Pick<ProviderSettingsPort, 'getProviderById'>>
  models: Pick<DimModelCatalog, 'admit'>
  media: Pick<DimModality, 'submit' | 'wait' | 'readResult'>
}

const MAX_RESULT_BYTES = 256 * 1024 * 1024

/** Desktop request/result shapes only. Native Modality owns tasks, HTTP, files and cancellation. */
export class DimMediaModels {
  constructor(private readonly options: MediaOptions) {}

  async generateImageStandalone(
    providerId: string,
    prompt: string,
    modelId: string,
    imageOptions?: ImageGenerationOptions,
    options?: { signal?: AbortSignal }
  ): Promise<StandaloneImageGenerationResult> {
    const text = prompt.trim()
    if (!text) throw new Error('Image generation prompt is required')
    const config = this.options.settings.getModelConfig(modelId, providerId)
    const normalized = normalizeImageGenerationOptions({
      ...config.imageGeneration,
      ...imageOptions
    })
    const { size, outputFormat, ...providerOptions } = normalized ?? {}
    const task = await this.run(
      providerId,
      modelId,
      {
        category: 'image',
        operation: 'generate',
        params: compact({
          prompt: text,
          size,
          outputFormat,
          providerOptions
        })
      },
      options?.signal
    )
    const images = await this.files(task, 'image/', options?.signal)
    if (!images.length) throw new Error('Image generation completed without image output')
    return { providerId, modelId, ...(normalized ? { options: normalized } : {}), images }
  }

  async generateVideoStandalone(
    providerId: string,
    prompt: string,
    modelId: string,
    videoOptions?: VideoGenerationOptions,
    options?: { signal?: AbortSignal }
  ): Promise<StandaloneVideoGenerationResult> {
    const text = prompt.trim()
    if (!text) throw new Error('Video generation prompt is required')
    const config = this.options.settings.getModelConfig(modelId, providerId)
    const normalized = resolveVideoGenerationRequestOptions(text, modelId, {
      ...config.videoGeneration,
      ...videoOptions
    })
    const provider = this.options.settings.getProviderById?.(providerId)
    const seconds = normalized?.duration ?? Number(normalized?.seconds)
    const task = await this.run(
      providerId,
      modelId,
      {
        category: 'video',
        operation: 'generate',
        params: compact({
          prompt: text,
          aspectRatio: normalized?.ratio,
          resolution: normalized?.resolution ?? normalized?.size,
          durationSeconds:
            Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : undefined,
          generateAudio: normalized?.generateAudio,
          providerOptions: {
            deepchat: normalized,
            deepchatBodyShape: resolveOpenAICompatibleVideoRequestBodyShape({
              providerId,
              providerApiType: provider?.apiType,
              baseUrl: provider?.baseUrl,
              modelId
            })
          }
        })
      },
      options?.signal
    )
    const videos = await this.files(task, 'video/', options?.signal)
    if (!videos.length) throw new Error('Video generation completed without video output')
    return { providerId, modelId, ...(normalized ? { options: normalized } : {}), videos }
  }

  async generateSpeechStandalone(
    providerId: string,
    text: string,
    modelId: string,
    speechOptions?: TtsSettings,
    options?: { signal?: AbortSignal }
  ): Promise<StandaloneSpeechGenerationResult> {
    const content = text.trim()
    if (!content) throw new Error('Speech generation text is required')
    const config = this.options.settings.getModelConfig(modelId, providerId)
    const normalized = normalizeTtsSettings({ ...config.tts, ...speechOptions })
    const { responseFormat, ...parameters } = normalized ?? {}
    const task = await this.run(
      providerId,
      modelId,
      {
        category: 'speech',
        operation: 'synthesize',
        params: compact({ text: content, ...parameters, outputFormat: responseFormat })
      },
      options?.signal
    )
    const files = await this.files(task, 'audio/', options?.signal)
    if (files.length !== 1) throw new Error('Speech generation requires one audio output')
    return { providerId, modelId, ...(normalized ? { options: normalized } : {}), audio: files[0] }
  }

  async transcribeAudioStandalone(
    providerId: string,
    modelId: string,
    audioBase64: string,
    mimeType: string,
    filename?: string,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    const content = audioBase64.trim()
    const mediaType = mimeType.trim().toLowerCase()
    if (!content) throw new Error('Audio data is required for transcription')
    if (!mediaType.startsWith('audio/'))
      throw new Error(`Invalid audio MIME type for transcription: ${mimeType}`)
    const task = await this.run(
      providerId,
      modelId,
      {
        category: 'speech',
        operation: 'transcribe',
        files: [
          {
            name: path.posix.basename((filename ?? 'audio').replaceAll('\\', '/')),
            media_type: mediaType,
            data_base64: content
          }
        ]
      },
      options?.signal
    )
    const data = task.result?.data
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.text !== 'string')
      throw new Error('Native transcription completed without a text result')
    return data.text.trim()
  }

  private async run(
    providerId: string,
    modelId: string,
    submission: Omit<DimMediaSubmission, 'model'>,
    signal?: AbortSignal
  ): Promise<DimMediaTask> {
    signal?.throwIfAborted()
    const model = await this.options.models.admit(providerId, modelId)
    signal?.throwIfAborted()
    const admitted = await this.options.media.submit({ ...submission, model }, signal)
    const task =
      admitted.state === 'queued' || admitted.state === 'running'
        ? await this.options.media.wait(admitted.task_id, signal)
        : admitted
    signal?.throwIfAborted()
    if (task.state !== 'succeeded')
      throw new Error(task.error?.message ?? `Native media task ${task.state}`)
    return task
  }

  private async files(task: DimMediaTask, prefix: string, signal?: AbortSignal) {
    const files: Array<{ data: string; mimeType: string }> = []
    let remaining = MAX_RESULT_BYTES
    for (const file of task.result?.files ?? []) {
      signal?.throwIfAborted()
      const mimeType = file.media_type.trim().toLowerCase()
      if (!mimeType.startsWith(prefix)) continue
      const bytes = await this.options.media.readResult(task, file.name, remaining, signal)
      remaining -= bytes.length
      files.push({ data: bytes.toString('base64'), mimeType })
    }
    return files
  }
}

function compact(value: Record<string, unknown>): { [key: string]: JsonValue } {
  return JSON.parse(JSON.stringify(value))
}
