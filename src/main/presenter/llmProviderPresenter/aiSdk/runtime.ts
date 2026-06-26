import { embedMany, generateId, generateImage, generateText, streamText } from 'ai'
import type { JSONValue, ModelMessage } from 'ai'
import type {
  ChatMessage,
  IConfigPresenter,
  LLM_EMBEDDING_ATTRS,
  LLM_PROVIDER,
  LLMResponse,
  MCPToolDefinition,
  ModelConfig
} from '@shared/presenter'
import { ApiEndpointType } from '@shared/model'
import {
  applyMoonshotKimiReasoningTemperaturePolicy,
  resolveMoonshotKimiTemperaturePolicy
} from '@shared/moonshotKimiPolicy'
import {
  normalizeImageGenerationOptions,
  supportsOpenAIImageGenerationSettings,
  type ImageGenerationOptions
} from '@shared/imageGenerationSettings'
import {
  isVideoGenerationModelConfig,
  normalizeVideoGenerationOptions,
  resolveOpenAICompatibleVideoRequestBodyShape,
  type VideoGenerationOptions,
  type VideoGenerationReference
} from '@shared/videoGenerationSettings'
import {
  isChatAudioTtsModel,
  isGeminiGenerateContentTtsModel,
  isTtsModelId,
  isTtsModelConfig,
  normalizeTtsSettings,
  ttsFormatToMimeType
} from '@shared/ttsSettings'
import { presenter } from '@/presenter'
import { EMBEDDING_TEST_KEY, isNormalized } from '@/utils/vector'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import { mcpToolsToAISDKTools } from './toolMapper'
import { mapMessagesToModelMessages } from './messageMapper'
import { buildProviderOptions } from './providerOptionsMapper'
import { ProxyAgent } from 'undici'
import { proxyConfig } from '../../proxyConfig'
import {
  type AiSdkProviderKind,
  createAiSdkProviderContext,
  normalizeGeminiBaseUrl
} from './providerFactory'
import { adaptAiSdkStream } from './streamAdapter'

type ImageGenerationProviderPayload = Record<string, JSONValue>
type ImageGenerationRequestOptions = {
  size?: `${number}x${number}`
  providerOptions?: Record<string, ImageGenerationProviderPayload>
}

type AiSdkPromptSplit = {
  instructions?: string
  messages: ModelMessage[]
}

type VideoGenerationRequestBody = {
  model: string
  prompt: string
  seconds?: string
  size?: string
  input_reference?: string | { mime_type?: string; data: string }
  content?: Array<Record<string, unknown>>
  ratio?: string
  duration?: number
  resolution?: string
  watermark?: boolean
  generate_audio?: boolean
  extra_body?: Record<string, unknown>
}

type VideoGenerationTaskResponse = {
  id?: string
  status?: string
  url?: string | null
  error?:
    | string
    | {
        message?: string
      }
    | null
}

const DEFAULT_GEMINI_TTS_VOICE = 'Kore'
const DEFAULT_GEMINI_PCM_SAMPLE_RATE = 24000
const DEFAULT_GEMINI_PCM_BITS_PER_SAMPLE = 16
const VIDEO_GENERATION_POLL_INTERVAL_MS = 3000
const PROMPT_VIDEO_DURATION_EN_PATTERN =
  /(^|[^0-9a-z])(?<duration>\d{1,2})\s*(?:s|sec|secs|second|seconds)\b/i
const PROMPT_VIDEO_DURATION_ZH_PATTERN = /(?<duration>\d{1,2})\s*秒/u

export interface AiSdkRuntimeContext {
  providerKind: AiSdkProviderKind
  provider: LLM_PROVIDER
  supportsOfficialAnthropicReasoning?: boolean
  configPresenter: IConfigPresenter
  defaultHeaders: Record<string, string>
  buildLegacyFunctionCallPrompt?: (tools: MCPToolDefinition[]) => string
  emitRequestTrace?: (
    modelConfig: ModelConfig,
    payload: {
      endpoint: string
      headers?: Record<string, string>
      body?: unknown
    }
  ) => Promise<void>
  buildTraceHeaders?: () => Record<string, string>
  cleanHeaders?: boolean
  supportsNativeTools?: (modelId: string, modelConfig: ModelConfig) => boolean
  shouldUseImageGeneration?: (modelId: string, modelConfig: ModelConfig) => boolean
  shouldUseVideoGeneration?: (modelId: string, modelConfig: ModelConfig) => boolean
  shouldUseTts?: (modelId: string, modelConfig: ModelConfig) => boolean
}

function resolveCapabilityProviderId(context: AiSdkRuntimeContext, modelId: string): string {
  const resolvedProviderId = context.configPresenter.getCapabilityProviderId?.(
    context.provider.id,
    modelId
  )

  if (typeof resolvedProviderId === 'string' && resolvedProviderId.trim().length > 0) {
    return resolvedProviderId
  }

  return context.provider.capabilityProviderId || context.provider.id
}

function supportsTemperatureControlRuntime(context: AiSdkRuntimeContext, modelId: string): boolean {
  const capabilityProviderId = resolveCapabilityProviderId(context, modelId)
  const directSupport = context.configPresenter.supportsTemperatureControl?.(
    capabilityProviderId,
    modelId
  )
  if (typeof directSupport === 'boolean') {
    return directSupport
  }

  const directCapability = context.configPresenter.getTemperatureCapability?.(
    capabilityProviderId,
    modelId
  )
  if (typeof directCapability === 'boolean') {
    return directCapability
  }

  return true
}

function normalizePromptValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item
        }

        if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
          return item.text
        }

        return ''
      })
      .filter((item) => item.trim().length > 0)
      .join('\n')
  }

  if (value && typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') {
      return value.text
    }

    const stringified = String(value)
    return stringified === '[object Object]' ? '' : stringified
  }

  return ''
}

function supportsPromptDerivedVideoDuration(modelId: string, duration: number): boolean {
  const normalizedModelId = modelId.trim().toLowerCase()

  if (normalizedModelId.startsWith('doubao-seedance-')) {
    return duration >= 4 && duration <= 15
  }

  return true
}

function resolvePromptVideoDuration(prompt: string, modelId: string): number | undefined {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) {
    return undefined
  }

  const matchedDuration =
    normalizedPrompt.match(PROMPT_VIDEO_DURATION_EN_PATTERN)?.groups?.duration ||
    normalizedPrompt.match(PROMPT_VIDEO_DURATION_ZH_PATTERN)?.groups?.duration

  if (!matchedDuration) {
    return undefined
  }

  const parsed = Number.parseInt(matchedDuration, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }

  return supportsPromptDerivedVideoDuration(modelId, parsed) ? parsed : undefined
}

function resolveVideoGenerationRequestOptions(
  prompt: string,
  modelId: string,
  options: VideoGenerationOptions | undefined
): VideoGenerationOptions | undefined {
  const normalizedOptions = normalizeVideoGenerationOptions(options)

  if (
    typeof normalizedOptions?.duration === 'number' ||
    (typeof normalizedOptions?.seconds === 'string' && normalizedOptions.seconds.trim().length > 0)
  ) {
    return normalizedOptions
  }

  const promptDuration = resolvePromptVideoDuration(prompt, modelId)
  if (promptDuration === undefined) {
    return normalizedOptions
  }

  return normalizeVideoGenerationOptions({
    ...normalizedOptions,
    duration: promptDuration
  })
}

function extractImagePrompt(messages: ChatMessage[]): string {
  return messages
    .map((message) => (message.role === 'user' ? normalizePromptValue(message.content) : ''))
    .filter((content) => content.trim().length > 0)
    .join('\n\n')
}

function extractVideoPrompt(messages: ChatMessage[]): string {
  return extractImagePrompt(messages)
}

function resolveSupportsNativeTools(
  context: AiSdkRuntimeContext,
  modelId: string,
  modelConfig: ModelConfig
): boolean {
  if (context.supportsNativeTools) {
    return context.supportsNativeTools(modelId, modelConfig)
  }

  return modelConfig.functionCall === true
}

function shouldUseImageGenerationRuntime(
  context: AiSdkRuntimeContext,
  modelId: string,
  modelConfig: ModelConfig
): boolean {
  if (context.shouldUseImageGeneration) {
    return context.shouldUseImageGeneration(modelId, modelConfig)
  }

  return modelConfig.apiEndpoint === ApiEndpointType.Image
}

function shouldUseVideoGenerationRuntime(
  context: AiSdkRuntimeContext,
  modelId: string,
  modelConfig: ModelConfig
): boolean {
  if (context.shouldUseVideoGeneration) {
    return context.shouldUseVideoGeneration(modelId, modelConfig)
  }

  return (
    modelConfig.apiEndpoint === ApiEndpointType.Video ||
    isVideoGenerationModelConfig(modelConfig, modelId)
  )
}

function shouldUseTtsRuntime(
  context: AiSdkRuntimeContext,
  modelId: string,
  modelConfig: ModelConfig
): boolean {
  if (context.shouldUseTts) {
    return context.shouldUseTts(modelId, modelConfig)
  }

  return (
    modelConfig.apiEndpoint === ApiEndpointType.AudioSpeech ||
    isTtsModelConfig(modelConfig) ||
    isTtsModelId(modelId)
  )
}

function buildGeminiTtsPrompt(text: string, instructions?: string): string {
  if (instructions?.trim()) {
    return `${instructions.trim()}\n\n${text}`.trim()
  }

  return text.trim()
}

function resolveGeminiTtsBaseUrl(provider: LLM_PROVIDER): string {
  const rawBaseUrl = (provider.baseUrl || '').trim()

  if (provider.apiType === 'gemini' || provider.id === 'gemini') {
    return normalizeGeminiBaseUrl(rawBaseUrl || undefined)
  }

  if (rawBaseUrl) {
    try {
      const parsed = new URL(rawBaseUrl.includes('://') ? rawBaseUrl : `https://${rawBaseUrl}`)
      if (provider.id === 'aihubmix' || /(^|\.)aihubmix\.com$/i.test(parsed.hostname)) {
        return normalizeGeminiBaseUrl(`${parsed.origin}/gemini`)
      }
    } catch {
      // Fall through to provider-specific fallback below.
    }
  }

  if (provider.id === 'aihubmix') {
    return normalizeGeminiBaseUrl('https://aihubmix.com/gemini')
  }

  return normalizeGeminiBaseUrl(rawBaseUrl || undefined)
}

function normalizeGeminiTtsResponseAudio(
  base64: string,
  mimeType: string | undefined
): { base64: string; mimeType: string } {
  const normalizedMimeType = (mimeType || '').trim()
  const lowerMimeType = normalizedMimeType.toLowerCase()

  if (!lowerMimeType || !(lowerMimeType.includes('l16') || lowerMimeType.includes('audio/pcm'))) {
    return {
      base64,
      mimeType: normalizedMimeType || 'audio/wav'
    }
  }

  const sampleRate = Number(/(?:rate|samplerate)=(\d+)/i.exec(normalizedMimeType)?.[1])
  const bitsPerSample = Number(/(?:bits|bitspersample)=(\d+)/i.exec(normalizedMimeType)?.[1])
  const pcmBuffer = Buffer.from(base64, 'base64')
  const resolvedSampleRate =
    Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : DEFAULT_GEMINI_PCM_SAMPLE_RATE
  const resolvedBitsPerSample =
    Number.isFinite(bitsPerSample) && bitsPerSample > 0
      ? bitsPerSample
      : DEFAULT_GEMINI_PCM_BITS_PER_SAMPLE
  const blockAlign = resolvedBitsPerSample / 8
  const byteRate = resolvedSampleRate * blockAlign
  const wavBuffer = Buffer.alloc(44 + pcmBuffer.length)

  wavBuffer.write('RIFF', 0)
  wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4)
  wavBuffer.write('WAVE', 8)
  wavBuffer.write('fmt ', 12)
  wavBuffer.writeUInt32LE(16, 16)
  wavBuffer.writeUInt16LE(1, 20)
  wavBuffer.writeUInt16LE(1, 22)
  wavBuffer.writeUInt32LE(resolvedSampleRate, 24)
  wavBuffer.writeUInt32LE(byteRate, 28)
  wavBuffer.writeUInt16LE(blockAlign, 32)
  wavBuffer.writeUInt16LE(resolvedBitsPerSample, 34)
  wavBuffer.write('data', 36)
  wavBuffer.writeUInt32LE(pcmBuffer.length, 40)
  pcmBuffer.copy(wavBuffer, 44)

  return {
    base64: wavBuffer.toString('base64'),
    mimeType: 'audio/wav'
  }
}

/**
 * Extracts the text to be synthesized from the last user message in the conversation.
 */
function extractTtsText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user') {
      const text = normalizePromptValue(msg.content)
      if (text.trim()) return text.trim()
    }
  }
  return ''
}

function extractChatAudioContentData(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined
  }

  const audioPart = content.find(
    (item) => item && typeof item === 'object' && 'type' in item && item.type === 'audio'
  )
  const audioData =
    audioPart && typeof audioPart === 'object' && 'audio' in audioPart
      ? (audioPart.audio as { data?: unknown } | undefined)?.data
      : undefined

  return typeof audioData === 'string' && audioData ? audioData : undefined
}

/**
 * Pattern A: calls the standard OpenAI-compatible /audio/speech endpoint.
 */
async function executeTtsPatternA(
  provider: LLM_PROVIDER,
  defaultHeaders: Record<string, string>,
  text: string,
  modelId: string,
  modelConfig: ModelConfig,
  timeout: number | undefined
): Promise<{ base64: string; mimeType: string }> {
  const tts = normalizeTtsSettings(modelConfig.tts)
  const format = tts?.responseFormat ?? 'mp3'
  const baseUrl = (provider.baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/i, '')
  const url = `${baseUrl}/v1/audio/speech`

  const body: Record<string, unknown> = {
    model: modelId,
    input: text,
    voice: tts?.voice ?? 'alloy',
    response_format: format
  }
  if (tts?.speed !== undefined) {
    body.speed = tts.speed
  }
  if (tts?.instructions) {
    body.instructions = tts.instructions
  }

  const controller = new AbortController()
  const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : undefined
  const proxyUrl = proxyConfig.getProxyUrl()
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined

  try {
    const fetchInit: RequestInit & { dispatcher?: ProxyAgent } = {
      method: 'POST',
      headers: {
        ...defaultHeaders,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.oauthToken || provider.apiKey || ''}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    }
    if (dispatcher) fetchInit.dispatcher = dispatcher
    const response = await fetch(url, fetchInit)

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`TTS request failed (${response.status}): ${errText}`)
    }

    const buffer = await response.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    return { base64, mimeType: ttsFormatToMimeType(format) }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

/**
 * Pattern B: calls the chat completions endpoint with audio output
 * (e.g. xiaomimimo mimo-v2.5-tts series).
 */
async function executeTtsPatternB(
  provider: LLM_PROVIDER,
  defaultHeaders: Record<string, string>,
  text: string,
  modelId: string,
  modelConfig: ModelConfig,
  timeout: number | undefined
): Promise<{ base64: string; mimeType: string }> {
  const tts = normalizeTtsSettings(modelConfig.tts)
  const format = tts?.responseFormat ?? 'wav'
  const baseUrl = (provider.baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/i, '')
  const url = `${baseUrl}/v1/chat/completions`

  const body: Record<string, unknown> = {
    model: modelId,
    messages: [
      { role: 'user', content: text },
      { role: 'assistant', content: text }
    ],
    modalities: ['text', 'audio'],
    audio: {
      format,
      ...(tts?.voice ? { voice: tts.voice } : {})
    }
  }

  const controller = new AbortController()
  const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : undefined
  const proxyUrl = proxyConfig.getProxyUrl()
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined

  try {
    const fetchInit: RequestInit & { dispatcher?: ProxyAgent } = {
      method: 'POST',
      headers: {
        ...defaultHeaders,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.oauthToken || provider.apiKey || ''}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    }
    if (dispatcher) fetchInit.dispatcher = dispatcher
    const response = await fetch(url, fetchInit)

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`TTS (chat audio) request failed (${response.status}): ${errText}`)
    }

    const json = (await response.json()) as {
      choices?: Array<{
        message?: {
          audio?: { data?: unknown }
          content?: unknown
        }
      }>
    }
    const firstMessage = json.choices?.[0]?.message
    const directAudioData =
      typeof firstMessage?.audio?.data === 'string' ? firstMessage.audio.data : undefined
    const audioData = directAudioData ?? extractChatAudioContentData(firstMessage?.content)
    if (!audioData) {
      throw new Error('TTS response missing audio data in choices[0].message.audio.data')
    }

    return { base64: audioData, mimeType: ttsFormatToMimeType(format) }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

async function executeTtsPatternC(
  provider: LLM_PROVIDER,
  defaultHeaders: Record<string, string>,
  text: string,
  modelId: string,
  modelConfig: ModelConfig,
  timeout: number | undefined
): Promise<{ base64: string; mimeType: string }> {
  const tts = normalizeTtsSettings(modelConfig.tts)
  const baseUrl = resolveGeminiTtsBaseUrl(provider)
  const requestModelId = modelId.trim().split('/').at(-1) || modelId
  const url = `${baseUrl}/models/${encodeURIComponent(requestModelId)}:generateContent`
  const body: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: buildGeminiTtsPrompt(text, tts?.instructions)
          }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: tts?.voice ?? DEFAULT_GEMINI_TTS_VOICE
          }
        }
      }
    }
  }

  const controller = new AbortController()
  const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : undefined
  const proxyUrl = proxyConfig.getProxyUrl()
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined

  try {
    const fetchInit: RequestInit & { dispatcher?: ProxyAgent } = {
      method: 'POST',
      headers: {
        ...defaultHeaders,
        'Content-Type': 'application/json',
        'x-goog-api-key': provider.oauthToken || provider.apiKey || ''
      },
      body: JSON.stringify(body),
      signal: controller.signal
    }
    if (dispatcher) fetchInit.dispatcher = dispatcher
    const response = await fetch(url, fetchInit)

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`TTS (gemini) request failed (${response.status}): ${errText}`)
    }

    const json = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { data?: string; mimeType?: string }
            inline_data?: { data?: string; mime_type?: string }
          }>
        }
      }>
    }
    const firstPart = json.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData?.data || part.inline_data?.data
    )
    const inlineData = firstPart?.inlineData
    const legacyInlineData = firstPart?.inline_data
    const audioData = inlineData?.data ?? legacyInlineData?.data
    if (!audioData) {
      throw new Error('TTS response missing inline audio data in candidates[0].content.parts')
    }

    return normalizeGeminiTtsResponseAudio(
      audioData,
      inlineData?.mimeType ?? legacyInlineData?.mime_type
    )
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

function resolveRequestTimeout(modelConfig: ModelConfig): number | undefined {
  const timeout = modelConfig.timeout
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
    return undefined
  }
  return Math.round(timeout)
}

function buildImageGenerationProviderPayload(
  providerOptionsKey: string,
  options: ImageGenerationOptions
): ImageGenerationProviderPayload {
  const officialOpenAI = providerOptionsKey === 'openai'
  const payload: ImageGenerationProviderPayload = {}

  if (options.quality) {
    payload.quality = options.quality
  }
  if (options.background) {
    payload.background = options.background
  }
  if (options.moderation) {
    payload.moderation = options.moderation
  }
  if (options.outputFormat) {
    payload[officialOpenAI ? 'outputFormat' : 'output_format'] = options.outputFormat
  }
  if (options.outputCompression !== undefined) {
    payload[officialOpenAI ? 'outputCompression' : 'output_compression'] = options.outputCompression
  }

  return payload
}

function buildImageGenerationRequestOptions(
  context: AiSdkRuntimeContext,
  providerOptionsKey: string,
  modelId: string,
  modelConfig: ModelConfig
): ImageGenerationRequestOptions {
  if (
    !supportsOpenAIImageGenerationSettings({
      providerId: context.provider.id,
      providerApiType: context.provider.apiType,
      providerKind: context.providerKind,
      providerOptionsKey,
      modelId,
      apiEndpoint: modelConfig.apiEndpoint,
      endpointType: modelConfig.endpointType,
      type: modelConfig.type
    })
  ) {
    return {}
  }

  const imageGeneration = normalizeImageGenerationOptions(modelConfig.imageGeneration)
  if (!imageGeneration) {
    return {}
  }

  const { size, ...providerImageOptions } = imageGeneration
  const providerPayload = buildImageGenerationProviderPayload(
    providerOptionsKey,
    providerImageOptions
  )
  const requestOptions: ImageGenerationRequestOptions = {}

  if (size) {
    requestOptions.size = size as `${number}x${number}`
  }

  if (Object.keys(providerPayload).length > 0) {
    requestOptions.providerOptions = {
      [providerOptionsKey]: providerPayload
    }
  }

  return requestOptions
}

function normalizeRuntimeModelConfig(
  context: AiSdkRuntimeContext,
  modelId: string,
  modelConfig: ModelConfig
): ModelConfig {
  return applyMoonshotKimiReasoningTemperaturePolicy(context.provider.id, modelId, modelConfig)
}

function resolveRuntimeTemperature(
  context: AiSdkRuntimeContext,
  modelId: string,
  modelConfig: ModelConfig,
  requestedTemperature: number | undefined
): { shouldSendTemperature: boolean; temperature: number | undefined } {
  const fixedTemperatureKimi = resolveMoonshotKimiTemperaturePolicy(
    context.provider.id,
    modelId,
    modelConfig.reasoning
  )
  if (fixedTemperatureKimi) {
    return {
      shouldSendTemperature: true,
      temperature: fixedTemperatureKimi.temperature
    }
  }

  return {
    shouldSendTemperature:
      supportsTemperatureControlRuntime(context, modelId) && requestedTemperature !== undefined,
    temperature: requestedTemperature
  }
}

function supportsTopPControlRuntime(context: AiSdkRuntimeContext, modelId: string): boolean {
  const capabilityProviderId = resolveCapabilityProviderId(context, modelId)
  if (capabilityProviderId === 'anthropic') {
    return supportsTemperatureControlRuntime(context, modelId)
  }

  return true
}

function resolveRuntimeTopP(
  context: AiSdkRuntimeContext,
  modelId: string,
  modelConfig: ModelConfig
): number | undefined {
  return supportsTopPControlRuntime(context, modelId) ? modelConfig.topP : undefined
}

function normalizeOpenAICompatibleBaseUrl(baseUrl: string | undefined): string {
  const normalized = (baseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '')
  if (!normalized) {
    return 'https://api.openai.com/v1'
  }

  return /\/v1(?:beta\d+)?$/i.test(normalized) ? normalized : `${normalized}/v1`
}

function normalizeVideoReferenceDataUrl(reference: VideoGenerationReference): string | undefined {
  if (reference.url?.trim()) {
    return reference.url.trim()
  }

  if (!reference.data?.trim()) {
    return undefined
  }

  const normalizedData = reference.data.trim()
  if (normalizedData.startsWith('data:')) {
    return normalizedData
  }

  const fallbackMimeType =
    reference.mimeType?.trim() ||
    (reference.type === 'image'
      ? 'image/png'
      : reference.type === 'audio'
        ? 'audio/mpeg'
        : 'video/mp4')

  return `data:${fallbackMimeType};base64,${normalizedData}`
}

function buildVideoGenerationContent(
  options: VideoGenerationOptions | undefined
): Array<Record<string, unknown>> | undefined {
  if (!options) {
    return undefined
  }

  const content: Record<string, unknown>[] = []

  for (const reference of options.references ?? []) {
    const url = normalizeVideoReferenceDataUrl(reference)
    if (!url) {
      continue
    }

    if (reference.type === 'image') {
      content.push({
        type: 'image_url',
        image_url: { url },
        role: 'reference_image'
      })
      continue
    }

    if (reference.type === 'audio') {
      content.push({
        type: 'audio_url',
        audio_url: { url },
        role: 'reference_audio'
      })
      continue
    }

    content.push({
      type: 'video_url',
      video_url: { url },
      role: 'reference_video'
    })
  }

  return content.length > 0 ? content : undefined
}

function buildVideoGenerationExtraBody(
  options: VideoGenerationOptions | undefined
): Record<string, unknown> | undefined {
  if (!options) {
    return undefined
  }

  const extraBody: Record<string, unknown> = {}

  if (typeof options.duration === 'number' && Number.isFinite(options.duration)) {
    extraBody.duration = options.duration
  }
  if (typeof options.ratio === 'string' && options.ratio.trim()) {
    extraBody.ratio = options.ratio.trim()
  }
  if (typeof options.resolution === 'string' && options.resolution.trim()) {
    extraBody.resolution = options.resolution.trim()
  }
  if (typeof options.watermark === 'boolean') {
    extraBody.watermark = options.watermark
  }
  if (typeof options.generateAudio === 'boolean') {
    extraBody.generate_audio = options.generateAudio
  }

  const content = buildVideoGenerationContent(options)
  if (content) {
    extraBody.content = content
  }

  return Object.keys(extraBody).length > 0 ? extraBody : undefined
}

function resolveFlatTopLevelVideoDuration(
  options: VideoGenerationOptions | undefined
): number | undefined {
  if (typeof options?.duration === 'number' && Number.isFinite(options.duration)) {
    return Math.max(-1, Math.round(options.duration))
  }

  if (typeof options?.seconds !== 'string') {
    return undefined
  }

  const parsed = Number.parseInt(options.seconds.trim(), 10)
  return Number.isFinite(parsed) ? Math.max(-1, parsed) : undefined
}

function buildVideoGenerationRequestBody(
  provider: LLM_PROVIDER,
  modelId: string,
  prompt: string,
  options: VideoGenerationOptions | undefined
): VideoGenerationRequestBody {
  const body: VideoGenerationRequestBody = {
    model: modelId,
    prompt
  }

  if (options?.seconds) {
    body.seconds = options.seconds
  }
  if (options?.size) {
    body.size = options.size
  }
  if (options?.inputReference) {
    if (typeof options.inputReference === 'string') {
      body.input_reference = options.inputReference
    } else {
      body.input_reference = {
        data: options.inputReference.data,
        ...(options.inputReference.mimeType ? { mime_type: options.inputReference.mimeType } : {})
      }
    }
  }

  const requestBodyShape = resolveOpenAICompatibleVideoRequestBodyShape({
    providerId: provider.id,
    providerApiType: provider.apiType,
    baseUrl: provider.baseUrl,
    modelId
  })

  if (requestBodyShape === 'flat-top-level') {
    const content = buildVideoGenerationContent(options)
    if (content) {
      body.content = content
    }
    if (options?.ratio) {
      body.ratio = options.ratio.trim()
    }
    const duration = resolveFlatTopLevelVideoDuration(options)
    if (duration !== undefined) {
      body.duration = duration
    }
    if (options?.resolution) {
      body.resolution = options.resolution.trim()
    }
    if (typeof options?.watermark === 'boolean') {
      body.watermark = options.watermark
    }
    if (typeof options?.generateAudio === 'boolean') {
      body.generate_audio = options.generateAudio
    }

    return body
  }

  const extraBody = buildVideoGenerationExtraBody(options)
  if (extraBody) {
    body.extra_body = extraBody
  }

  return body
}

function extractVideoTaskError(response: VideoGenerationTaskResponse | null | undefined): string {
  const error = response?.error
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }

  if (
    error &&
    typeof error === 'object' &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message.trim()
  }

  return 'Video generation failed'
}

function resolveVideoTaskStatus(response: VideoGenerationTaskResponse | null | undefined): string {
  return typeof response?.status === 'string' ? response.status.trim().toLowerCase() : ''
}

function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
      return
    }

    const onAbort = () => {
      clearTimeout(timeoutId)
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
    }

    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function executeOpenAICompatibleVideoGeneration(
  provider: LLM_PROVIDER,
  defaultHeaders: Record<string, string>,
  modelId: string,
  prompt: string,
  modelConfig: ModelConfig,
  timeout: number | undefined
): Promise<{ base64: string; mimeType: string }> {
  const normalizedOptions = resolveVideoGenerationRequestOptions(
    prompt,
    modelId,
    modelConfig.videoGeneration
  )
  const baseUrl = normalizeOpenAICompatibleBaseUrl(provider.baseUrl)
  const createUrl = `${baseUrl}/videos`
  const body = buildVideoGenerationRequestBody(provider, modelId, prompt, normalizedOptions)
  const controller = new AbortController()
  const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : undefined
  const proxyUrl = proxyConfig.getProxyUrl()
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined

  const fetchJson = async <T>(url: string, init: RequestInit): Promise<T> => {
    const fetchInit: RequestInit & { dispatcher?: ProxyAgent } = {
      ...init,
      headers: {
        ...defaultHeaders,
        Authorization: `Bearer ${provider.oauthToken || provider.apiKey || ''}`,
        ...(init.headers as Record<string, string> | undefined)
      },
      signal: controller.signal
    }
    if (dispatcher) fetchInit.dispatcher = dispatcher

    const response = await fetch(url, fetchInit)
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Video request failed (${response.status}): ${errorText}`)
    }

    return (await response.json()) as T
  }

  const fetchBinary = async (url: string): Promise<{ buffer: ArrayBuffer; mimeType: string }> => {
    const fetchInit: RequestInit & { dispatcher?: ProxyAgent } = {
      method: 'GET',
      headers: {
        ...defaultHeaders,
        Authorization: `Bearer ${provider.oauthToken || provider.apiKey || ''}`
      },
      signal: controller.signal
    }
    if (dispatcher) fetchInit.dispatcher = dispatcher

    const response = await fetch(url, fetchInit)
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Video content download failed (${response.status}): ${errorText}`)
    }

    return {
      buffer: await response.arrayBuffer(),
      mimeType: response.headers.get('content-type')?.split(';')[0]?.trim() || 'video/mp4'
    }
  }

  try {
    let task = await fetchJson<VideoGenerationTaskResponse>(createUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    const taskId = typeof task.id === 'string' ? task.id.trim() : ''
    if (!taskId) {
      throw new Error('Video generation response missing task id')
    }

    let status = resolveVideoTaskStatus(task)
    while (status !== 'completed') {
      if (status === 'failed') {
        throw new Error(extractVideoTaskError(task))
      }

      await delayWithAbort(VIDEO_GENERATION_POLL_INTERVAL_MS, controller.signal)
      task = await fetchJson<VideoGenerationTaskResponse>(
        `${createUrl}/${encodeURIComponent(taskId)}`,
        {
          method: 'GET'
        }
      )
      status = resolveVideoTaskStatus(task)
    }

    const contentUrl =
      typeof task.url === 'string' && task.url.trim().length > 0
        ? task.url.trim()
        : `${createUrl}/${encodeURIComponent(taskId)}/content`
    const { buffer, mimeType } = await fetchBinary(contentUrl)

    return {
      base64: Buffer.from(buffer).toString('base64'),
      mimeType
    }
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
}

async function buildPromptRuntime(
  context: AiSdkRuntimeContext,
  messages: ChatMessage[],
  modelId: string,
  modelConfig: ModelConfig,
  tools: MCPToolDefinition[]
) {
  const supportsNativeTools = resolveSupportsNativeTools(context, modelId, modelConfig)
  const capabilityProviderId = resolveCapabilityProviderId(context, modelId)
  const providerContext = createAiSdkProviderContext({
    providerKind: context.providerKind,
    provider: context.provider,
    configPresenter: context.configPresenter,
    defaultHeaders: context.defaultHeaders,
    modelId,
    cleanHeaders: context.cleanHeaders
  })
  const mappedMessages = mapMessagesToModelMessages(messages, {
    tools,
    supportsNativeTools,
    buildLegacyFunctionCallPrompt: context.buildLegacyFunctionCallPrompt,
    preserveOpenAICompatibleReasoningContent: context.providerKind === 'openai-compatible',
    preferOpenAICompatibleAudioDataUrl: context.providerKind === 'openai-compatible'
  })
  const toolsMap = supportsNativeTools ? mcpToolsToAISDKTools(tools) : {}
  const providerOptionResult = buildProviderOptions({
    providerId: context.provider.id,
    capabilityProviderId,
    supportsOfficialAnthropicReasoning: context.supportsOfficialAnthropicReasoning,
    providerOptionsKey: providerContext.providerOptionsKey,
    apiType: providerContext.apiType,
    modelId,
    modelConfig,
    tools,
    messages: mappedMessages
  })
  const promptSplit = splitLeadingSystemMessagesForAiSdk(providerOptionResult.messages)

  return {
    providerContext,
    instructions: promptSplit.instructions,
    messages: promptSplit.messages,
    providerOptions: providerOptionResult.providerOptions,
    tools: toolsMap,
    supportsNativeTools
  }
}

function splitLeadingSystemMessagesForAiSdk(messages: ModelMessage[]): AiSdkPromptSplit {
  const systemContent: string[] = []
  let firstConversationIndex = 0

  while (firstConversationIndex < messages.length) {
    const message = messages[firstConversationIndex]
    if (message.role !== 'system') {
      break
    }

    const content = typeof message.content === 'string' ? message.content.trim() : ''
    if (content) {
      systemContent.push(content)
    }
    firstConversationIndex += 1
  }

  return {
    ...(systemContent.length > 0 ? { instructions: systemContent.join('\n\n') } : {}),
    messages: messages.slice(firstConversationIndex)
  }
}

function usageToLlmResponse(
  usage:
    | {
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
      }
    | undefined
): LLMResponse['totalUsage'] | undefined {
  if (!usage) {
    return undefined
  }

  return {
    prompt_tokens: usage.inputTokens ?? 0,
    completion_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
  }
}

export async function runAiSdkGenerateText(
  context: AiSdkRuntimeContext,
  messages: ChatMessage[],
  modelId: string,
  modelConfig: ModelConfig,
  temperature?: number,
  maxTokens?: number
): Promise<LLMResponse> {
  const normalizedModelConfig = normalizeRuntimeModelConfig(context, modelId, modelConfig)
  const runtime = await buildPromptRuntime(context, messages, modelId, normalizedModelConfig, [])
  const { shouldSendTemperature, temperature: resolvedTemperature } = resolveRuntimeTemperature(
    context,
    modelId,
    normalizedModelConfig,
    temperature
  )
  const resolvedTopP = resolveRuntimeTopP(context, modelId, normalizedModelConfig)
  const timeout = resolveRequestTimeout(normalizedModelConfig)
  const requestBody = {
    model: runtime.providerContext.resolvedModelId ?? modelId,
    maxOutputTokens: maxTokens,
    ...(shouldSendTemperature && resolvedTemperature !== undefined
      ? { temperature: resolvedTemperature }
      : {}),
    ...(resolvedTopP !== undefined ? { topP: resolvedTopP } : {})
  }

  await context.emitRequestTrace?.(normalizedModelConfig, {
    endpoint: runtime.providerContext.endpoint,
    headers: context.buildTraceHeaders?.() ?? context.defaultHeaders,
    body: requestBody
  })

  const result = await generateText({
    model: runtime.providerContext.model,
    ...(runtime.instructions ? { instructions: runtime.instructions } : {}),
    messages: runtime.messages,
    allowSystemInMessages: false,
    providerOptions: runtime.providerOptions as any,
    ...(timeout ? { abortSignal: AbortSignal.timeout(timeout) } : {}),
    ...(shouldSendTemperature && resolvedTemperature !== undefined
      ? { temperature: resolvedTemperature }
      : {}),
    ...(resolvedTopP !== undefined ? { topP: resolvedTopP } : {}),
    maxOutputTokens: maxTokens
  })

  return {
    content: result.text,
    reasoning_content: result.finalStep.reasoningText,
    totalUsage: usageToLlmResponse(result.usage)
  }
}

export async function* runAiSdkCoreStream(
  context: AiSdkRuntimeContext,
  messages: ChatMessage[],
  modelId: string,
  modelConfig: ModelConfig,
  temperature: number,
  maxTokens: number,
  tools: MCPToolDefinition[]
): AsyncGenerator<LLMCoreStreamEvent> {
  const normalizedModelConfig = normalizeRuntimeModelConfig(context, modelId, modelConfig)
  const timeout = resolveRequestTimeout(normalizedModelConfig)

  if (shouldUseTtsRuntime(context, modelId, normalizedModelConfig)) {
    const text = extractTtsText(messages)
    const usePatternB = isChatAudioTtsModel(modelId)
    const usePatternC = isGeminiGenerateContentTtsModel(modelId)

    const { base64, mimeType } = usePatternC
      ? await executeTtsPatternC(
          context.provider,
          context.defaultHeaders,
          text,
          modelId,
          normalizedModelConfig,
          timeout
        )
      : usePatternB
        ? await executeTtsPatternB(
            context.provider,
            context.defaultHeaders,
            text,
            modelId,
            normalizedModelConfig,
            timeout
          )
        : await executeTtsPatternA(
            context.provider,
            context.defaultHeaders,
            text,
            modelId,
            normalizedModelConfig,
            timeout
          )

    const dataUrl = `data:${mimeType};base64,${base64}`
    const cachedAudio = await presenter.devicePresenter.cacheImage(dataUrl)
    yield {
      type: 'image_data',
      image_data: {
        data: cachedAudio,
        mimeType
      }
    }
    yield {
      type: 'stop',
      stop_reason: 'complete'
    }
    return
  }

  if (shouldUseVideoGenerationRuntime(context, modelId, normalizedModelConfig)) {
    const prompt = extractVideoPrompt(messages)
    const normalizedVideoOptions = resolveVideoGenerationRequestOptions(
      prompt,
      modelId,
      normalizedModelConfig.videoGeneration
    )
    const requestBody = buildVideoGenerationRequestBody(
      context.provider,
      modelId,
      prompt,
      normalizedVideoOptions
    )

    await context.emitRequestTrace?.(normalizedModelConfig, {
      endpoint: `${normalizeOpenAICompatibleBaseUrl(context.provider.baseUrl)}/videos`,
      headers: context.buildTraceHeaders?.() ?? context.defaultHeaders,
      body: requestBody
    })

    const { base64, mimeType } = await executeOpenAICompatibleVideoGeneration(
      context.provider,
      context.defaultHeaders,
      modelId,
      prompt,
      normalizedModelConfig,
      timeout
    )

    yield {
      type: 'image_data',
      image_data: {
        data: `data:${mimeType};base64,${base64}`,
        mimeType
      }
    }
    yield {
      type: 'stop',
      stop_reason: 'complete'
    }
    return
  }

  if (shouldUseImageGenerationRuntime(context, modelId, normalizedModelConfig)) {
    const prompt = extractImagePrompt(messages)

    const providerContext = createAiSdkProviderContext({
      providerKind: context.providerKind,
      provider: context.provider,
      configPresenter: context.configPresenter,
      defaultHeaders: context.defaultHeaders,
      modelId,
      cleanHeaders: context.cleanHeaders
    })

    if (!providerContext.imageModel) {
      throw new Error(`Image generation is not supported by provider ${context.provider.id}`)
    }

    const imageGenerationRequestOptions = buildImageGenerationRequestOptions(
      context,
      providerContext.providerOptionsKey,
      modelId,
      normalizedModelConfig
    )

    await context.emitRequestTrace?.(modelConfig, {
      endpoint: providerContext.imageEndpoint ?? providerContext.endpoint,
      headers: context.buildTraceHeaders?.() ?? context.defaultHeaders,
      body: {
        model: providerContext.resolvedModelId ?? modelId,
        prompt,
        ...imageGenerationRequestOptions
      }
    })

    const result = await generateImage({
      model: providerContext.imageModel,
      prompt,
      ...imageGenerationRequestOptions,
      ...(timeout ? { abortSignal: AbortSignal.timeout(timeout) } : {})
    })

    for (const image of result.images) {
      const dataUrl = `data:${image.mediaType};base64,${image.base64}`
      const cachedImage = await presenter.devicePresenter.cacheImage(dataUrl)
      yield {
        type: 'image_data',
        image_data: {
          data: cachedImage,
          mimeType: image.mediaType
        }
      }
    }

    yield {
      type: 'stop',
      stop_reason: 'complete'
    }
    return
  }

  const runtime = await buildPromptRuntime(context, messages, modelId, normalizedModelConfig, tools)
  const { shouldSendTemperature, temperature: resolvedTemperature } = resolveRuntimeTemperature(
    context,
    modelId,
    normalizedModelConfig,
    temperature
  )
  const resolvedTopP = resolveRuntimeTopP(context, modelId, normalizedModelConfig)
  const requestBody = {
    model: runtime.providerContext.resolvedModelId ?? modelId,
    maxOutputTokens: maxTokens,
    ...(shouldSendTemperature && resolvedTemperature !== undefined
      ? { temperature: resolvedTemperature }
      : {}),
    ...(resolvedTopP !== undefined ? { topP: resolvedTopP } : {}),
    tools: tools.map((tool) => tool.function.name)
  }

  await context.emitRequestTrace?.(normalizedModelConfig, {
    endpoint: runtime.providerContext.endpoint,
    headers: context.buildTraceHeaders?.() ?? context.defaultHeaders,
    body: requestBody
  })

  const result = streamText({
    model: runtime.providerContext.model,
    ...(runtime.instructions ? { instructions: runtime.instructions } : {}),
    messages: runtime.messages,
    allowSystemInMessages: false,
    tools: runtime.tools,
    providerOptions: runtime.providerOptions as any,
    ...(timeout ? { abortSignal: AbortSignal.timeout(timeout) } : {}),
    ...(shouldSendTemperature && resolvedTemperature !== undefined
      ? { temperature: resolvedTemperature }
      : {}),
    ...(resolvedTopP !== undefined ? { topP: resolvedTopP } : {}),
    maxOutputTokens: maxTokens
  })

  yield* adaptAiSdkStream(result.stream, {
    supportsNativeTools: runtime.supportsNativeTools,
    cacheImage: (data) => presenter.devicePresenter.cacheImage(data)
  })
}

export async function runAiSdkEmbeddings(
  context: AiSdkRuntimeContext,
  modelId: string,
  texts: string[]
): Promise<number[][]> {
  const providerContext = createAiSdkProviderContext({
    providerKind: context.providerKind,
    provider: context.provider,
    configPresenter: context.configPresenter,
    defaultHeaders: context.defaultHeaders,
    modelId,
    cleanHeaders: context.cleanHeaders,
    wrapThinkReasoning: false
  })

  if (!providerContext.embeddingModel) {
    throw new Error(`embedding is not supported by provider ${context.provider.id}`)
  }

  const result = await embedMany({
    model: providerContext.embeddingModel,
    values: texts
  })

  return result.embeddings
}

export async function runAiSdkDimensions(
  context: AiSdkRuntimeContext,
  modelId: string
): Promise<LLM_EMBEDDING_ATTRS> {
  const embeddings = await runAiSdkEmbeddings(context, modelId, [
    EMBEDDING_TEST_KEY || generateId()
  ])
  return {
    dimensions: embeddings[0].length,
    normalized: isNormalized(embeddings[0])
  }
}
