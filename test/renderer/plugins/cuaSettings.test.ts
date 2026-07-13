import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const scriptPath = resolve(process.cwd(), 'plugins/cua/settings/assets/index.js')

const flushPromises = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const renderSettingsDom = (): void => {
  document.body.innerHTML = `
    <span id="plugin-state"></span>
    <strong id="runtime-state"></strong>
    <strong id="runtime-version"></strong>
    <strong id="runtime-platform"></strong>
    <code id="runtime-command"></code>
    <code id="runtime-helper-app"></code>
    <strong id="mcp-state"></strong>
    <div id="diagnostics-title"></div>
    <div id="diagnostics-rows"></div>
    <p id="message"></p>
    <details id="message-detail" hidden>
      <summary>Message details</summary>
      <pre id="message-detail-text"></pre>
    </details>
    <details id="technical-details"></details>
    <a id="project-link"></a>
    <button id="check"></button>
    <button id="guide"></button>
    <button id="disable"></button>
  `
}

type CuaSettingsWindow = Window & { deepchatPlugin?: unknown }

const runSettingsScript = async (): Promise<void> => {
  const script = await readFile(scriptPath, 'utf8')
  window.eval(`(() => {\n${script}\n})()`)
}

const getDiagnosticRows = (): string[] =>
  Array.from(document.querySelectorAll('#diagnostics-rows .row')).map((row) =>
    Array.from(row.children)
      .map((child) => child.textContent ?? '')
      .join(':')
  )

describe('CUA plugin settings', () => {
  beforeEach(() => {
    renderSettingsDom()
    delete (window as CuaSettingsWindow).deepchatPlugin
  })

  it('shows clear permission guidance after a successful permission check', async () => {
    const pluginWindow = window as CuaSettingsWindow

    pluginWindow.deepchatPlugin = {
      getStatus: vi.fn().mockResolvedValue({
        enabled: true,
        platform: 'darwin',
        arch: 'arm64',
        runtime: {
          state: 'ready',
          version: '0.1.5',
          command: '/mock/cua-driver',
          helperAppPath: '/mock/DeepChat Computer Use.app'
        },
        mcpServers: [
          {
            serverId: 'cua-driver',
            enabled: true,
            running: true
          }
        ]
      }),
      invokeAction: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          accessibility: 'granted',
          screenRecording: 'denied'
        }
      }),
      disable: vi.fn()
    }

    await runSettingsScript()
    await flushPromises()

    document.getElementById('check')?.click()
    await flushPromises()

    expect(document.getElementById('diagnostics-title')?.textContent).toBe('macOS Permissions')
    expect(getDiagnosticRows()).toEqual(['Accessibility:Granted', 'Screen Recording:Denied'])
    expect(document.getElementById('message')?.textContent).toBe(
      'Grant the missing permissions, then check again.'
    )
    expect(document.getElementById('runtime-helper-app')?.textContent).toBe(
      '/mock/DeepChat Computer Use.app'
    )
  })

  it('shows plugin MCP errors as friendly status with folded details', async () => {
    const pluginWindow = window as CuaSettingsWindow

    pluginWindow.deepchatPlugin = {
      getStatus: vi.fn().mockResolvedValue({
        enabled: true,
        runtime: {
          state: 'installed',
          version: '0.1.5',
          command: '/mock/cua-driver',
          helperAppPath: '/mock/DeepChat Computer Use.app'
        },
        mcpServers: [
          {
            serverId: 'cua-driver',
            enabled: true,
            running: false,
            lastError: 'connect failed'
          }
        ]
      }),
      invokeAction: vi.fn(),
      disable: vi.fn()
    }

    await runSettingsScript()
    await flushPromises()

    expect(document.getElementById('mcp-state')?.textContent).toBe('Error')
    expect(document.getElementById('message')?.textContent).toBe(
      'MCP server is not running correctly.'
    )
    expect(document.getElementById('message-detail')?.hidden).toBe(false)
    expect(document.getElementById('message-detail-text')?.textContent).toBe('connect failed')
  })

  it('hides misleading PowerShell hints from the primary permission error', async () => {
    const pluginWindow = window as CuaSettingsWindow

    pluginWindow.deepchatPlugin = {
      getStatus: vi.fn().mockResolvedValue({
        enabled: true,
        platform: 'darwin',
        arch: 'arm64',
        runtime: {
          state: 'ready',
          version: '0.1.5',
          command: '/mock/cua-driver',
          helperAppPath: '/mock/DeepChat Computer Use.app'
        },
        mcpServers: [
          {
            serverId: 'cua-driver',
            enabled: true,
            running: true
          }
        ]
      }),
      invokeAction: vi.fn().mockResolvedValue({
        ok: false,
        error:
          'Command failed: deepchat-permission-probe --output /tmp/status.json hint: PowerShell 5.1 strips quotes around JSON field names.'
      }),
      disable: vi.fn()
    }

    await runSettingsScript()
    await flushPromises()

    document.getElementById('check')?.click()
    await flushPromises()

    expect(document.getElementById('message')?.textContent).toBe(
      'Permission status could not be read from this CUA build. Open setup, then check again.'
    )
    expect(document.getElementById('message')?.textContent).not.toContain('PowerShell')
    expect(document.getElementById('message-detail-text')?.textContent).toContain('PowerShell')
  })
})
