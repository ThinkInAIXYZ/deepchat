import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const scriptPath = resolve(process.cwd(), 'plugins/feishu/settings/assets/index.js')

const flushPromises = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const renderSettingsDom = (): void => {
  document.body.innerHTML = `
    <span id="plugin-state"></span>
    <strong id="mcp-state"></strong>
    <input id="brand" />
    <input id="app-id" />
    <input id="app-secret" />
    <input id="preset" />
    <p id="message"></p>
    <button id="save"></button>
    <button id="disable"></button>
    <a id="preset-docs"></a>
  `
}

type FeishuSettingsWindow = Window & { deepchatPlugin?: unknown }

const runSettingsScript = async (): Promise<void> => {
  const script = await readFile(scriptPath, 'utf8')
  window.eval(`(() => {\n${script}\n})()`)
}

describe('Feishu plugin settings', () => {
  beforeEach(() => {
    renderSettingsDom()
    delete (window as FeishuSettingsWindow).deepchatPlugin
  })

  it.each([
    [
      'when the MCP server is unavailable',
      {
        enabled: true,
        mcpServers: []
      },
      'Unavailable'
    ],
    [
      'when the MCP server is running',
      {
        enabled: true,
        mcpServers: [
          {
            serverId: 'feishu-tools',
            enabled: true,
            running: true,
            lastError: 'stale failure'
          }
        ]
      },
      'Running'
    ],
    [
      'when the MCP server is stopped but still enabled',
      {
        enabled: true,
        mcpServers: [
          {
            serverId: 'feishu-tools',
            enabled: true,
            running: false
          }
        ]
      },
      'Stopped'
    ],
    [
      'when the MCP server is disabled without an error',
      {
        enabled: true,
        mcpServers: [
          {
            serverId: 'feishu-tools',
            enabled: false,
            running: false
          }
        ]
      },
      'Disabled'
    ]
  ])('clears stale MCP errors %s', async (_label, status, expectedState) => {
    const pluginWindow = window as FeishuSettingsWindow

    document.getElementById('message')!.textContent = 'stale failure'
    pluginWindow.deepchatPlugin = {
      getStatus: vi.fn().mockResolvedValue(status),
      invokeAction: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      disable: vi.fn()
    }

    await runSettingsScript()
    await flushPromises()

    expect(document.getElementById('mcp-state')?.textContent).toBe(expectedState)
    expect(document.getElementById('message')?.textContent).toBe('')
  })

  it('shows the latest MCP error when the server reports one', async () => {
    const pluginWindow = window as FeishuSettingsWindow

    pluginWindow.deepchatPlugin = {
      getStatus: vi.fn().mockResolvedValue({
        enabled: true,
        mcpServers: [
          {
            serverId: 'feishu-tools',
            enabled: false,
            running: false,
            lastError: 'connect failed'
          }
        ]
      }),
      invokeAction: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      disable: vi.fn()
    }

    await runSettingsScript()
    await flushPromises()

    expect(document.getElementById('mcp-state')?.textContent).toBe('Error')
    expect(document.getElementById('message')?.textContent).toBe('connect failed')
  })
})
