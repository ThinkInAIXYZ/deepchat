import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import {
  ProviderRuntimeCore,
  ProviderDbLoader,
  ModelCapabilities,
  createCapabilityResolver
} from '@deepchat/provider'
import { createAiSdkProviderContext } from '@deepchat/provider/aiSdk/providerFactory'
import { adaptAiSdkStream } from '@deepchat/provider/aiSdk/streamAdapter'

const requests = []
const server = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  requests.push({ path: request.url, body: body ? JSON.parse(body) : null })
  response.setHeader('content-type', 'application/json')
  response.end(
    JSON.stringify({
      id: 'fixture',
      object: 'chat.completion',
      created: 1,
      model: 'fixture-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'portable reply' },
          finish_reason: 'stop'
        }
      ],
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }
    })
  )
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
const provider = {
  id: 'fixture',
  name: 'Fixture',
  apiType: 'openai-completions',
  apiKey: 'fixture-key',
  enable: true,
  baseUrl
}
const model = { id: 'fixture-model', name: 'Fixture', providerId: 'fixture', type: 'chat' }
const config = {
  maxTokens: 32,
  contextLength: 2048,
  temperature: 0.7,
  vision: false,
  functionCall: false,
  reasoning: false,
  type: 'chat'
}
const settings = {
  getProviders: () => [provider],
  getProviderById: () => provider,
  getProviderModels: () => [model],
  getCustomModels: () => [],
  getModelStatus: () => true,
  getModelConfig: () => config,
  getModelRouteConfig: () => config,
  getProviderModelRouteMetadata: () => undefined,
  getAzureApiVersion: () => undefined,
  setProviderModels: () => {},
  notifyModelsChanged: () => {}
}
const catalog = new ProviderDbLoader({
  readBuiltIn: () => null,
  readCache: () => null,
  readMeta: () => null,
  writeCache: () => {
    throw new Error('fixture catalog is read-only')
  },
  writeMeta: () => {
    throw new Error('fixture catalog is read-only')
  },
  fetch: () => {
    throw new Error('catalog network forbidden')
  },
  now: () => 1,
  ttlHours: () => 4
})
catalog.setPrivacyModeResolver(() => true)
await catalog.initialize()
assert.equal((await catalog.refreshIfNeeded(true, { automatic: true })).status, 'skipped')
const capabilities = new ModelCapabilities(catalog)
const mediaWrites = []
const host = {
  getLanguage: () => 'en-US',
  getDefaultHeaders: () => ({}),
  catalog,
  capabilities,
  capabilityResolver: createCapabilityResolver(capabilities),
  cacheImage: async (data) => {
    mediaWrites.push(data)
    return 'owned://fixture-image'
  },
  fetchRemoteFile: async () => {
    throw new Error('remote media unavailable')
  },
  auth: {
    normalizeCodexBaseUrl: () => baseUrl,
    codexFetch: () => {
      throw new Error('OAuth unavailable in fixture')
    },
    usesGrokOAuth: () => false,
    grokFetch: () => {
      throw new Error('OAuth unavailable in fixture')
    },
    peekGrokToken: () => null,
    refreshGrokToken: async () => null,
    isGrokAuthenticated: () => false,
    isTrustedGrokEndpoint: () => false
  }
}
const runtime = new ProviderRuntimeCore(settings, host, () => {})
try {
  const result = await runtime.generateText('fixture', 'hello portable core', model.id, 0.7, 32)
  assert.equal(result.content, 'portable reply')
  const completionRequest = requests.find((request) => request.path === '/v1/chat/completions')
  assert.ok(completionRequest)
  assert.equal(completionRequest.body.messages[0].content, 'hello portable core')
  const requestCountBeforeCancellation = requests.length
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(
    runtime.generateText('fixture', 'cancelled', model.id, 0.7, 32, { signal: cancelled.signal }),
    { name: 'AbortError' }
  )
  assert.equal(requests.length, requestCountBeforeCancellation)
  const params = {
    providerKind: 'openai-codex',
    provider: { ...provider, id: 'openai-codex' },
    providerSettings: settings,
    defaultHeaders: {},
    modelId: model.id,
    auth: host.auth
  }
  assert.throws(() => createAiSdkProviderContext(params), /OAuth unavailable/)
  let specialRequests = 0
  const special = createAiSdkProviderContext({
    ...params,
    wrapThinkReasoning: false,
    auth: {
      ...host.auth,
      codexFetch: (_headers, fetch) => async (url, init) => {
        specialRequests++
        return fetch(url, init)
      }
    }
  })
  await special.model
    .doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'oauth fixture' }] }],
      maxOutputTokens: 8
    })
    .catch(() => {})
  assert.equal(specialRequests, 1)
  async function* imageStream() {
    yield { type: 'file', file: { mediaType: 'image/png', base64: 'ZmFrZQ==' } }
  }
  const streamOptions = { supportsNativeTools: true, cacheImage: host.cacheImage }
  const images = []
  for await (const event of adaptAiSdkStream(imageStream(), streamOptions)) images.push(event)
  assert.equal(mediaWrites.length, 1)
  assert.equal(images[0].image_data.data, 'owned://fixture-image')
  await assert.rejects(async () => {
    for await (const _event of adaptAiSdkStream(imageStream(), {
      ...streamOptions,
      cacheImage: async () => {
        throw new Error('media refused')
      }
    })) {
    }
  }, /media refused/)
  console.log(
    'provider artifact: request, cancellation, OAuth adapter/refusal, media ownership/refusal, privacy passed'
  )
} finally {
  await runtime.shutdown()
  capabilities.dispose()
  await new Promise((resolve) => server.close(resolve))
}
