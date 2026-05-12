#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(__dirname, '..')
const WARNING_TEXT =
  'Feishu/Lark credentials are not configured. Please open the plugin settings and set your App ID and App Secret, then restart the MCP server.'
const LARK_MCP_PACKAGE = '@larksuiteoapi/lark-mcp@0.5.1'

function loadConfig() {
  const configPath = join(pluginRoot, 'config.json')
  if (!existsSync(configPath)) return null
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {
    return null
  }
}

const config = loadConfig()
const appId = config?.appId || process.env.FEISHU_APP_ID || ''
const appSecret = config?.appSecret || process.env.FEISHU_APP_SECRET || ''
const brand = config?.brand || process.env.FEISHU_BRAND || 'feishu'
const preset = config?.preset || ''

function sendFrame(message) {
  const body = JSON.stringify(message)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
}

function sendResult(id, result) {
  sendFrame({ jsonrpc: '2.0', id, result })
}

function sendError(id, code, message) {
  sendFrame({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message
    }
  })
}

function handleWarningRequest(message) {
  if (message.id == null || typeof message.method !== 'string') {
    return
  }

  switch (message.method) {
    case 'initialize':
      sendResult(message.id, {
        protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'feishu-tools',
          version: '0.1.0'
        },
        instructions: WARNING_TEXT
      })
      return
    case 'ping':
    case 'logging/setLevel':
      sendResult(message.id, {})
      return
    case 'tools/list':
      sendResult(message.id, {
        tools: [
          {
            name: 'feishu_configure',
            description:
              'Feishu/Lark is not configured. Open plugin settings to set App ID and App Secret.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false
            }
          }
        ]
      })
      return
    case 'tools/call':
      sendResult(message.id, {
        content: [
          {
            type: 'text',
            text: WARNING_TEXT
          }
        ],
        isError: true
      })
      return
    case 'resources/list':
      sendResult(message.id, { resources: [] })
      return
    case 'prompts/list':
      sendResult(message.id, { prompts: [] })
      return
    default:
      sendError(message.id, -32601, `Method not found: ${message.method}`)
  }
}

function startWarningServer() {
  let buffer = Buffer.alloc(0)

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) {
        return
      }

      const header = buffer.slice(0, headerEnd).toString('utf8')
      const match = header.match(/content-length\s*:\s*(\d+)/i)
      if (!match) {
        buffer = Buffer.alloc(0)
        return
      }

      const bodyLength = Number(match[1])
      const frameEnd = headerEnd + 4 + bodyLength
      if (buffer.length < frameEnd) {
        return
      }

      const body = buffer.slice(headerEnd + 4, frameEnd).toString('utf8')
      buffer = buffer.slice(frameEnd)

      try {
        const message = JSON.parse(body)
        if (Array.isArray(message)) {
          for (const item of message) {
            handleWarningRequest(item)
          }
          continue
        }
        handleWarningRequest(message)
      } catch {
        // Ignore malformed frames and keep the warning server alive.
      }
    }
  })

  process.stdin.resume()
}

function resolveSpawnEnv() {
  const registryOverride = process.env.REGISTRY_OVERRIDE?.trim()
  if (!registryOverride) {
    return process.env
  }

  return {
    ...process.env,
    npm_config_registry: registryOverride
  }
}

function startConfiguredServer() {
  const args = ['-y', LARK_MCP_PACKAGE, 'mcp', '-a', appId, '-s', appSecret]
  if (brand === 'lark') {
    args.push('--domain', 'https://open.larksuite.com')
  }
  if (preset) {
    args.push('-t', preset)
  }

  const child = spawn('npx', args, {
    stdio: 'inherit',
    env: resolveSpawnEnv()
  })

  child.on('error', (error) => {
    console.error(`Failed to launch Feishu MCP via npx: ${error.message}`)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

if (appId && appSecret) {
  startConfiguredServer()
} else {
  startWarningServer()
}
