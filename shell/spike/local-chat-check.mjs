#!/usr/bin/env node
/**
 * Exercises the chat pipeline against a local stand-in provider.
 *
 * Starts an OpenAI-compatible mock on a random port, points the sidecar at it,
 * selects a model and sends one message, so the whole path runs without a real
 * API key: session creation, agent turn, provider HTTP, streaming events and
 * persistence.
 *
 * Usage: node shell/spike/local-chat-check.mjs [path/to/sidecar.mjs]
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const sidecarEntry = process.argv[2] ?? 'out/sidecar/app.mjs'
const profile = process.env.DEEPCHAT_PROFILE ?? mkdtempSync(path.join(tmpdir(), 'deepchat-chat-'))

const REPLY = '你好，我是本地 mock 模型。'
const MODEL_ID = 'mock-local-model'
// A provider whose apiType speaks chat completions, which this mock implements.
const PROVIDER_ID = 'typesafe'

const mock = createServer((request, response) => {
  console.log(`[mock] ${request.method} ${request.url}`)
  if (request.method === 'GET' && request.url?.startsWith('/v1/models')) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: [{ id: MODEL_ID, object: 'model' }] }))
    return
  }

  if (request.method === 'POST' && request.url?.startsWith('/v1/responses')) {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const wantsStream = body.includes('"stream":true')
      const message = {
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: REPLY, annotations: [] }]
      }
      // The Responses API returns a fully-populated object; the SDK validates it.
      const responseObject = {
        id: 'resp-1',
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        status: 'completed',
        model: MODEL_ID,
        output: [message],
        error: null,
        incomplete_details: null,
        instructions: null,
        metadata: {},
        parallel_tool_calls: true,
        previous_response_id: null,
        reasoning: { effort: null, summary: null },
        store: false,
        temperature: 1,
        text: { format: { type: 'text' } },
        tool_choice: 'auto',
        tools: [],
        top_p: 1,
        truncation: 'disabled',
        usage: { input_tokens: 5, output_tokens: 8, total_tokens: 13 },
        user: null
      }

      if (!wantsStream) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(responseObject))
        return
      }

      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      const send = (type, data) =>
        response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
      send('response.created', {
        response: { ...responseObject, status: 'in_progress', output: [] }
      })
      send('response.in_progress', {
        response: { ...responseObject, status: 'in_progress', output: [] }
      })
      send('response.output_item.added', {
        output_index: 0,
        item: { ...message, status: 'in_progress', content: [] }
      })
      send('response.content_part.added', {
        item_id: 'msg-1',
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] }
      })
      send('response.output_text.delta', {
        item_id: 'msg-1',
        output_index: 0,
        content_index: 0,
        delta: REPLY
      })
      send('response.output_text.done', {
        item_id: 'msg-1',
        output_index: 0,
        content_index: 0,
        text: REPLY
      })
      send('response.content_part.done', {
        item_id: 'msg-1',
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: REPLY, annotations: [] }
      })
      send('response.output_item.done', { output_index: 0, item: message })
      send('response.completed', { response: responseObject })
      response.end()
    })
    return
  }

  if (request.method === 'POST' && request.url?.startsWith('/v1/chat/completions')) {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const wantsStream = body.includes('"stream":true')
      if (!wantsStream) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            id: 'mock-1',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: MODEL_ID,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: REPLY },
                finish_reason: 'stop'
              }
            ],
            usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 }
          })
        )
        return
      }

      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      const chunk = (delta, finish = null) =>
        `data: ${JSON.stringify({
          id: 'mock-1',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: MODEL_ID,
          choices: [{ index: 0, delta, finish_reason: finish }]
        })}\n\n`
      response.write(chunk({ role: 'assistant', content: '' }))
      response.write(chunk({ content: REPLY }))
      response.write(chunk({}, 'stop'))
      response.write('data: [DONE]\n\n')
      response.end()
    })
    return
  }

  response.writeHead(404).end()
})

await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
const port = mock.address().port
const baseUrl = `http://127.0.0.1:${port}/v1`

// The built-in agent's model comes from the legacy `assistantModel` setting when
// the app starts, so seed the profile before launching instead of racing the
// migration with a route call.
writeFileSync(
  path.join(profile, 'app-settings.json'),
  JSON.stringify(
    {
      language: 'zh-CN',
      assistantModel: { providerId: PROVIDER_ID, modelId: MODEL_ID },
      providers: [
        {
          id: PROVIDER_ID,
          name: 'OpenAI',
          apiType: 'openai',
          apiKey: 'local',
          baseUrl,
          enable: true,
          models: [
            {
              id: MODEL_ID,
              name: 'Mock Local',
              group: 'local',
              providerId: PROVIDER_ID,
              enabled: true,
              functionCall: true
            }
          ]
        }
      ]
    },
    null,
    2
  )
)

const child = spawn(process.execPath, [sidecarEntry], {
  env: { ...process.env, DEEPCHAT_USER_DATA: profile },
  stdio: ['pipe', 'pipe', 'inherit']
})

const events = []
let nextId = 1
const pending = new Map()

child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (message.event) {
      events.push(message.event)
      if (message.event === 'chat.stream.failed') {
        console.log('stream failed:', JSON.stringify(message.payload).slice(0, 400))
      }
      if (message.event === 'chat.stream.completed') {
        console.log('stream completed:', JSON.stringify(message.payload).slice(0, 200))
      }
      continue
    }
    const resolve = pending.get(message.id)
    if (resolve) {
      pending.delete(message.id)
      resolve(message)
    }
  }
})

const call = (route, input) =>
  new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    child.stdin.write(`${JSON.stringify({ id, route, input })}\n`)
  })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

console.log(`profile: ${profile}`)
console.log(`mock provider: ${baseUrl}`)
await wait(12000)

const update = await call('providers.update', {
  providerId: PROVIDER_ID,
  updates: { apiKey: 'local', baseUrl, enable: true }
})
console.log('providers.update ->', update.error ?? 'ok')

// Models come from the provider, not from the seeded settings file.
const refresh = await call('providers.refreshModels', { providerId: PROVIDER_ID })
console.log('providers.refreshModels ->', refresh.error ?? 'ok')
await wait(1500)

const models = await call('providers.listModels', { providerId: PROVIDER_ID })
console.log('providers.listModels ->', JSON.stringify(models.result).slice(0, 160))

const agentUpdate = await call('config.updateDeepChatAgent', {
  agentId: 'deepchat',
  updates: { assistantModel: { providerId: PROVIDER_ID, modelId: MODEL_ID } }
})
console.log('config.updateDeepChatAgent ->', agentUpdate.error ?? 'ok')

const created = await call('sessions.create', {
  agentId: 'deepchat',
  message: '你好，请用一句话介绍自己',
  providerId: PROVIDER_ID,
  modelId: MODEL_ID
})
console.log(
  'sessions.create ->',
  created.error ?? `session ${created.result?.session?.id} turn ${created.result?.initialTurn?.requestId}`
)

await wait(4000)
const sessionId = created.result?.session?.id
const messages = sessionId
  ? await call('sessions.listMessagesPage', { sessionId, limit: 20 })
  : null
if (messages?.result) {
  const text = JSON.stringify(messages.result)
  console.log('messages contract ok:', Array.isArray(messages.result.messages))
  console.log('reply contains mock text:', text.includes(REPLY))
} else if (messages?.error) {
  console.log('chat.getMessages ->', String(messages.error).slice(0, 160))
}
console.log('events seen:', [...new Set(events)].filter((name) => name.startsWith('chat.')).join(', '))

child.kill()
mock.close()
process.exit(0)
