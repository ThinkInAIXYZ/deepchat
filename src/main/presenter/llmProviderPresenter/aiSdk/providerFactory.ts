import type {
  AWS_BEDROCK_PROVIDER,
  IConfigPresenter,
  LLM_PROVIDER,
  VERTEX_PROVIDER
} from '@shared/presenter'
import { wrapLanguageModel } from 'ai'
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createVertex } from '@ai-sdk/google-vertex'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOllama } from 'ollama-ai-provider'
import { ProxyAgent } from 'undici'
import { proxyConfig } from '../../proxyConfig'
import { createReasoningMiddleware } from './middlewares/reasoningMiddleware'

export type AiSdkProviderKind =
  | 'openai-compatible'
  | 'openai-responses'
  | 'anthropic'
  | 'gemini'
  | 'vertex'
  | 'aws-bedrock'
  | 'ollama'

export interface CreateAiSdkProviderContextParams {
  providerKind: AiSdkProviderKind
  provider: LLM_PROVIDER
  configPresenter: IConfigPresenter
  defaultHeaders: Record<string, string>
  modelId: string
  cleanHeaders?: boolean
  wrapThinkReasoning?: boolean
}

export interface AiSdkProviderContext {
  providerOptionsKey: string
  apiType:
    | 'openai_chat'
    | 'openai_responses'
    | 'anthropic'
    | 'google'
    | 'vertex'
    | 'bedrock'
    | 'ollama'
  model: any
  embeddingModel?: any
  imageModel?: any
  endpoint: string
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const VERTEX_SCHEMA_TYPE_MAP: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  object: 'OBJECT',
  array: 'ARRAY',
  null: 'NULL'
}

function normalizeVertexSchemaNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => normalizeVertexSchemaNode(item))
  }

  if (!isObjectRecord(node)) {
    return node
  }

  const normalized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' && typeof value === 'string') {
      normalized[key] = VERTEX_SCHEMA_TYPE_MAP[value.toLowerCase()] ?? value
      continue
    }

    normalized[key] = normalizeVertexSchemaNode(value)
  }

  return normalized
}

export function normalizeVertexRequestBody(body: unknown): unknown {
  if (!isObjectRecord(body)) {
    return body
  }

  const nextBody: Record<string, unknown> = { ...body }
  const systemInstruction = nextBody.systemInstruction

  if (isObjectRecord(systemInstruction) && !('role' in systemInstruction)) {
    nextBody.systemInstruction = {
      role: 'user',
      ...systemInstruction
    }
  }

  if (Array.isArray(nextBody.tools)) {
    nextBody.tools = nextBody.tools.map((tool) => {
      if (!isObjectRecord(tool) || !Array.isArray(tool.functionDeclarations)) {
        return tool
      }

      return {
        ...tool,
        functionDeclarations: tool.functionDeclarations.map((declaration) => {
          if (!isObjectRecord(declaration)) {
            return declaration
          }

          return {
            ...declaration,
            ...(declaration.parameters
              ? { parameters: normalizeVertexSchemaNode(declaration.parameters) }
              : {})
          }
        })
      }
    })
  }

  const toolConfig = nextBody.toolConfig

  if (!isObjectRecord(toolConfig)) {
    return nextBody
  }

  const functionCallingConfig = toolConfig.functionCallingConfig
  if (!isObjectRecord(functionCallingConfig)) {
    return nextBody
  }

  const hasOnlyAutoMode =
    functionCallingConfig.mode === 'AUTO' &&
    Object.keys(functionCallingConfig).length === 1 &&
    Object.keys(toolConfig).length === 1

  if (hasOnlyAutoMode) {
    delete nextBody.toolConfig
  }

  return nextBody
}

function normalizeRequestBody(
  provider: LLM_PROVIDER,
  requestUrl: string,
  body: RequestInit['body'] | null | undefined
): RequestInit['body'] | null | undefined {
  if (body == null || typeof body !== 'string') {
    return body
  }

  const isVertexRequest =
    provider.apiType === 'vertex' ||
    requestUrl.includes(':generateContent') ||
    requestUrl.includes(':streamGenerateContent')

  if (!isVertexRequest) {
    return body
  }

  try {
    const parsed = JSON.parse(body)
    const normalized = normalizeVertexRequestBody(parsed)
    return JSON.stringify(normalized)
  } catch {
    return body
  }
}

function createFetchMiddleware(
  provider: LLM_PROVIDER,
  defaultHeaders: Record<string, string>,
  cleanHeaders = false
) {
  const proxyUrl = proxyConfig.getProxyUrl()
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined

  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requestUrl = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
    const nextInit: RequestInit & { dispatcher?: ProxyAgent } = {
      ...init
    }

    if (dispatcher) {
      nextInit.dispatcher = dispatcher
    }

    const headers = new Headers(init?.headers ?? {})
    Object.entries(defaultHeaders).forEach(([key, value]) => headers.set(key, value))

    if (cleanHeaders) {
      const allowedHeaders = new Set([
        'authorization',
        'content-type',
        'accept',
        'http-referer',
        'x-title'
      ])

      const sanitized = new Headers()
      headers.forEach((value, key) => {
        const normalized = key.toLowerCase()
        if (
          allowedHeaders.has(normalized) ||
          (!normalized.startsWith('x-stainless-') &&
            !normalized.includes('user-agent') &&
            !normalized.includes('openai-'))
        ) {
          sanitized.set(key, value)
        }
      })

      if (!sanitized.has('Authorization') && provider.apiKey) {
        sanitized.set('Authorization', `Bearer ${provider.apiKey}`)
      }

      nextInit.headers = sanitized
    } else {
      nextInit.headers = headers
    }

    nextInit.body = normalizeRequestBody(provider, requestUrl, nextInit.body)
    return fetch(url, nextInit)
  }
}

function buildOpenAIEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

export function normalizeAnthropicBaseUrl(baseUrl: string | undefined): string {
  const normalized = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')

  if (normalized.endsWith('/v1/messages')) {
    return normalized.slice(0, -'/messages'.length)
  }

  if (normalized.endsWith('/messages')) {
    return normalized.slice(0, -'/messages'.length)
  }

  if (normalized.endsWith('/v1')) {
    return normalized
  }

  return `${normalized}/v1`
}

export function normalizeVertexBaseUrl(
  baseUrl: string | undefined,
  apiKey: string | undefined,
  apiVersion: 'v1' | 'v1beta1' = 'v1'
): string | undefined {
  const normalized = baseUrl?.trim().replace(/\/+$/, '')
  if (!normalized) {
    return undefined
  }

  if (!apiKey) {
    return normalized
  }

  if (/\/publishers\/google$/i.test(normalized)) {
    return normalized
  }

  if (new RegExp(`/${apiVersion}$`, 'i').test(normalized)) {
    return `${normalized}/publishers/google`
  }

  return `${normalized}/${apiVersion}/publishers/google`
}

export function createAiSdkProviderContext(
  params: CreateAiSdkProviderContextParams
): AiSdkProviderContext {
  const baseUrl = params.provider.baseUrl || ''
  const fetch = createFetchMiddleware(
    params.provider,
    params.defaultHeaders,
    params.cleanHeaders === true
  )
  const maybeWrapModel = (model: any): any =>
    params.wrapThinkReasoning === false
      ? model
      : wrapLanguageModel({
          model,
          middleware: createReasoningMiddleware()
        })

  switch (params.providerKind) {
    case 'openai-responses': {
      const provider = createOpenAI({
        baseURL: baseUrl,
        apiKey: params.provider.apiKey,
        headers: params.defaultHeaders,
        fetch
      })

      return {
        providerOptionsKey: 'openai',
        apiType: 'openai_responses',
        model: maybeWrapModel(provider.responses(params.modelId) as any),
        embeddingModel: provider.embedding(params.modelId),
        imageModel: provider.image(params.modelId),
        endpoint: buildOpenAIEndpoint(baseUrl || 'https://api.openai.com/v1', '/responses')
      }
    }

    case 'openai-compatible': {
      if (params.provider.id === 'openai') {
        const provider = createOpenAI({
          baseURL: baseUrl,
          apiKey: params.provider.apiKey,
          headers: params.defaultHeaders,
          fetch
        })

        return {
          providerOptionsKey: 'openai',
          apiType: 'openai_chat',
          model: maybeWrapModel(provider.chat(params.modelId) as any),
          embeddingModel: provider.embedding(params.modelId),
          imageModel: provider.image(params.modelId),
          endpoint: buildOpenAIEndpoint(baseUrl || 'https://api.openai.com/v1', '/chat/completions')
        }
      }

      const provider = createOpenAICompatible({
        name: params.provider.id,
        baseURL: baseUrl,
        apiKey: params.provider.apiKey,
        headers: params.defaultHeaders,
        fetch,
        includeUsage: true
      })

      return {
        providerOptionsKey: params.provider.id,
        apiType: 'openai_chat',
        model: maybeWrapModel(provider.chatModel(params.modelId) as any),
        embeddingModel: provider.embeddingModel(params.modelId),
        imageModel: provider.imageModel(params.modelId),
        endpoint: buildOpenAIEndpoint(baseUrl, '/chat/completions')
      }
    }

    case 'anthropic': {
      const anthropicBaseUrl = normalizeAnthropicBaseUrl(baseUrl)
      const provider = createAnthropic({
        baseURL: anthropicBaseUrl,
        apiKey: params.provider.apiKey || process.env.ANTHROPIC_API_KEY,
        headers: params.defaultHeaders,
        fetch,
        name: 'anthropic'
      })

      return {
        providerOptionsKey: 'anthropic',
        apiType: 'anthropic',
        model: maybeWrapModel(provider.messages(params.modelId) as any),
        endpoint: `${anthropicBaseUrl}/messages`
      }
    }

    case 'gemini': {
      const provider = createGoogleGenerativeAI({
        baseURL: baseUrl || undefined,
        apiKey: params.provider.apiKey || process.env.GEMINI_API_KEY,
        headers: params.defaultHeaders,
        fetch
      })

      return {
        providerOptionsKey: 'google',
        apiType: 'google',
        model: maybeWrapModel(provider.languageModel(params.modelId) as any),
        embeddingModel: provider.embeddingModel(params.modelId),
        imageModel: provider.imageModel(params.modelId),
        endpoint: baseUrl || 'https://generativelanguage.googleapis.com'
      }
    }

    case 'vertex': {
      const vertexProvider = params.provider as VERTEX_PROVIDER
      const vertexApiVersion = (vertexProvider.apiVersion as 'v1' | 'v1beta1') || 'v1'
      const vertexBaseUrl = normalizeVertexBaseUrl(
        vertexProvider.baseUrl,
        vertexProvider.apiKey || undefined,
        vertexApiVersion
      )
      const provider = createVertex({
        apiKey: vertexProvider.apiKey || undefined,
        baseURL: vertexBaseUrl,
        project: vertexProvider.projectId || process.env.GOOGLE_VERTEX_PROJECT,
        location: vertexProvider.location || process.env.GOOGLE_VERTEX_LOCATION,
        headers: params.defaultHeaders,
        fetch,
        googleAuthOptions:
          vertexProvider.accountClientEmail && vertexProvider.accountPrivateKey
            ? {
                credentials: {
                  client_email: vertexProvider.accountClientEmail,
                  private_key: vertexProvider.accountPrivateKey
                }
              }
            : undefined
      })

      return {
        providerOptionsKey: 'vertex',
        apiType: 'vertex',
        model: maybeWrapModel(provider.languageModel(params.modelId) as any),
        embeddingModel: provider.embeddingModel(params.modelId),
        imageModel: provider.imageModel(params.modelId),
        endpoint: vertexBaseUrl || 'https://aiplatform.googleapis.com/v1/publishers/google'
      }
    }

    case 'aws-bedrock': {
      const bedrockProvider = params.provider as AWS_BEDROCK_PROVIDER
      const provider = createAmazonBedrock({
        apiKey: bedrockProvider.apiKey || undefined,
        baseURL: bedrockProvider.baseUrl || undefined,
        region: bedrockProvider.credential?.region || process.env.AWS_REGION || 'us-east-1',
        accessKeyId: bedrockProvider.credential?.accessKeyId || process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey:
          bedrockProvider.credential?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY,
        headers: params.defaultHeaders,
        fetch
      })

      return {
        providerOptionsKey: 'bedrock',
        apiType: 'bedrock',
        model: maybeWrapModel(provider.languageModel(params.modelId) as any),
        embeddingModel: (provider as any).embeddingModel?.(params.modelId),
        imageModel: (provider as any).imageModel?.(params.modelId),
        endpoint: bedrockProvider.baseUrl || 'https://bedrock-runtime.amazonaws.com'
      }
    }

    case 'ollama': {
      const provider = createOllama({
        baseURL: baseUrl || undefined,
        headers: params.defaultHeaders,
        fetch
      })

      return {
        providerOptionsKey: 'ollama',
        apiType: 'ollama',
        model: maybeWrapModel(provider(params.modelId) as any),
        embeddingModel:
          (provider as any).embeddingModel?.(params.modelId) ??
          (provider as any).textEmbeddingModel?.(params.modelId),
        endpoint: baseUrl || 'http://127.0.0.1:11434'
      }
    }
  }
}
