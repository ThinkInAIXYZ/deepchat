#!/usr/bin/env node
/**
 * Runs the full stack (Go shell + real main process sidecar) against a local
 * mock provider, sends one message and screenshots the chat window.
 *
 * Usage: node shell/spike/local-chat-ui.mjs [screenshot.png]
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const shot = process.argv[2] ?? '/tmp/deepchat-mygo-chat.png'
const profile = mkdtempSync(path.join(tmpdir(), 'deepchat-ui-chat-'))
const REPLY = '你好，我是本地 mock 模型，界面链路已经跑通。'
const MODEL_ID = 'mock-local-model'
const PROVIDER_ID = 'typesafe'

const message = (status, text) => ({
  id: 'msg-1',
  type: 'message',
  role: 'assistant',
  status,
  content: text === undefined ? [] : [{ type: 'output_text', text, annotations: [] }]
})

const responseObject = (model) => ({
  id: 'resp-1',
  object: 'response',
  created_at: Math.floor(Date.now() / 1000),
  status: 'completed',
  model,
  output: [message('completed', REPLY)],
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
})

const mock = createServer((request, response) => {
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
      const model = /"model":"([^"]+)"/.exec(body)?.[1] ?? MODEL_ID
      if (!body.includes('"stream":true')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(responseObject(model)))
        return
      }

      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      })
      const send = (type, data) =>
        response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
      const initial = { ...responseObject(model), status: 'in_progress', output: [] }
      send('response.created', { response: initial })
      send('response.in_progress', { response: initial })
      send('response.output_item.added', { output_index: 0, item: message('in_progress') })
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
      send('response.output_item.done', { output_index: 0, item: message('completed', REPLY) })
      send('response.completed', { response: responseObject(model) })
      response.end()
    })
    return
  }

  response.writeHead(404).end()
})

await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${mock.address().port}/v1`

writeFileSync(
  path.join(profile, 'app-settings.json'),
  JSON.stringify(
    {
      language: 'zh-CN',
      providers: [
        {
          id: PROVIDER_ID,
          name: 'TypeSafe',
          apiType: 'openai-completions',
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

const probe = `
new Promise(async (resolve) => {
  // The app registers its IPC handlers near the end of startup.
  await new Promise((r) => setTimeout(r, 14000))
  try {
    const lang = await window.deepchat.invoke('config.getLanguage', {})
    const list = await window.deepchat.invoke('providers.list', {})
    await window.deepchat.invoke('providers.update', {
      providerId: '${PROVIDER_ID}',
      updates: { apiKey: 'local', baseUrl: '${baseUrl}', enable: true }
    })
    await window.deepchat.invoke('providers.refreshModels', { providerId: '${PROVIDER_ID}' })
    const created = await window.deepchat.invoke('sessions.create', {
      agentId: 'deepchat',
      message: '你好，请用一句话介绍自己',
      providerId: '${PROVIDER_ID}',
      modelId: '${MODEL_ID}'
    })
    const seen = []
    window.deepchat.on('sessions.updated', () => seen.push('sessions.updated'))
    window.deepchat.on('chat.stream.updated', () => seen.push('stream'))
    await window.deepchat.invoke('onboarding.complete', { force: true })
    await new Promise((r) => setTimeout(r, 1500))
    console.log('events seen by page:', seen.length)
    location.hash = '#/chat'
    await new Promise((r) => setTimeout(r, 2500))
    // Open the session the way a user would: click its row in the sidebar.
    const row = [...document.querySelectorAll('*')].find(
      (element) =>
        element.children.length === 0 && element.textContent?.includes('你好，请用一句话介绍自己')
    )
    row?.closest('button, [role=button], li, div')?.click()
    await new Promise((r) => setTimeout(r, 5000))
    const page = await window.deepchat.invoke('sessions.listMessagesPage', {
      sessionId: created.session.id,
      limit: 20
    })
    resolve(JSON.stringify({
      sessionId: created.session.id,
      messages: page.messages.length,
      pageEvents: seen.length,
      hasReply: JSON.stringify(page).includes('mock')
    }))
  } catch (error) {
    resolve('ERR ' + JSON.stringify(String(error).slice(0, 240)) + ' lang=' + (typeof lang !== 'undefined' ? JSON.stringify(lang) : 'n/a') + ' providers=' + (typeof list !== 'undefined' ? list.providers.length : 'n/a'))
  }
})
`

const child = spawn(
  'go',
  [
    'run',
    '.',
    '-seconds',
    '70',
    '-renderer',
    '../../out/renderer',
    '-sidecar',
    '../../out/sidecar/app.mjs',
    '-shot',
    shot,
    '-probe',
    probe
  ],
  {
    cwd: path.join(process.cwd(), 'shell', 'spike'),
    env: {
      ...process.env,
      DEEPCHAT_USER_DATA: profile,
      PATH: `/opt/homebrew/bin:${process.env.PATH}`
    },
    stdio: ['ignore', 'pipe', 'inherit']
  }
)

child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  for (const line of chunk.split('\n')) {
    if (line.includes('probe.result') || line.includes('SPIKE shot')) console.log(line.trim())
  }
})

child.on('exit', () => {
  mock.close()
  console.log(`screenshot: ${shot}`)
})
