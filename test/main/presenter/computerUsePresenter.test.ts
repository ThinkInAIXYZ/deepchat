import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IConfigPresenter, IMCPPresenter, MCPServerConfig } from '@shared/presenter'
import { COMPUTER_USE_SERVER_NAME } from '@shared/types/computerUse'

const execFileAsyncMock = vi.hoisted(() => vi.fn())
const execFileMock = vi.hoisted(() => {
  const mock = vi.fn()
  Reflect.set(mock, Symbol.for('nodejs.util.promisify.custom'), execFileAsyncMock)
  return mock
})

vi.mock('child_process', () => ({
  execFile: execFileMock
}))

type PresenterMocks = {
  configPresenter: IConfigPresenter
  mcpPresenter: IMCPPresenter
  servers: Record<string, MCPServerConfig>
  settings: Map<string, unknown>
  updateMcpServer: ReturnType<typeof vi.fn>
  addMcpServer: ReturnType<typeof vi.fn>
  removeMcpServer: ReturnType<typeof vi.fn>
  startServer: ReturnType<typeof vi.fn>
  stopServer: ReturnType<typeof vi.fn>
}

function createPresenterMocks(mcpEnabled = true): PresenterMocks {
  const servers: Record<string, MCPServerConfig> = {}
  const settings = new Map<string, unknown>()

  const configPresenter = {
    getSetting: vi.fn((key: string) => settings.get(key)),
    setSetting: vi.fn((key: string, value: unknown) => {
      settings.set(key, value)
    }),
    getMcpServers: vi.fn(async () => servers),
    getMcpEnabled: vi.fn(async () => mcpEnabled),
    addMcpServer: vi.fn(async (name: string, config: MCPServerConfig) => {
      servers[name] = config
      return true
    }),
    updateMcpServer: vi.fn(async (name: string, config: Partial<MCPServerConfig>) => {
      servers[name] = {
        ...servers[name],
        ...config
      } as MCPServerConfig
    }),
    removeMcpServer: vi.fn(async (name: string) => {
      delete servers[name]
    })
  } as unknown as IConfigPresenter

  const mcpPresenter = {
    isServerRunning: vi.fn(async () => false),
    startServer: vi.fn(async () => {}),
    stopServer: vi.fn(async () => {}),
    updateMcpServer: vi.fn(async (name: string, config: Partial<MCPServerConfig>) => {
      await configPresenter.updateMcpServer(name, config)
    })
  } as unknown as IMCPPresenter

  return {
    configPresenter,
    mcpPresenter,
    servers,
    settings,
    updateMcpServer: mcpPresenter.updateMcpServer as ReturnType<typeof vi.fn>,
    addMcpServer: configPresenter.addMcpServer as ReturnType<typeof vi.fn>,
    removeMcpServer: configPresenter.removeMcpServer as ReturnType<typeof vi.fn>,
    startServer: mcpPresenter.startServer as ReturnType<typeof vi.fn>,
    stopServer: mcpPresenter.stopServer as ReturnType<typeof vi.fn>
  }
}

async function createHelper(appPath: string) {
  const helperAppPath = path.join(
    appPath,
    'runtime',
    'computer-use',
    'cua-driver',
    'current',
    'DeepChat Computer Use.app'
  )
  const helperBinaryPath = path.join(helperAppPath, 'Contents', 'MacOS', 'cua-driver')
  const infoPlistPath = path.join(helperAppPath, 'Contents', 'Info.plist')

  await mkdir(path.dirname(helperBinaryPath), { recursive: true })
  await writeFile(helperBinaryPath, '#!/bin/sh\n', { mode: 0o755 })
  await writeFile(
    infoPlistPath,
    '<plist><dict><key>CFBundleShortVersionString</key><string>0.0.5</string></dict></plist>'
  )

  return { helperAppPath, helperBinaryPath }
}

describe('ComputerUsePresenter', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-computer-use-'))
    execFileAsyncMock.mockImplementation(async (file: string, args: string[] = []) => {
      if (file === '/usr/bin/lipo') {
        return { stdout: 'arm64\n', stderr: '' }
      }
      if (file === '/usr/bin/open') {
        const outputIndex = args.indexOf('--output')
        if (outputIndex >= 0) {
          await writeFile(
            args[outputIndex + 1],
            JSON.stringify({ accessibility: true, screen_recording: false })
          )
        }
        return { stdout: '', stderr: '' }
      }
      return {
        stdout: 'Accessibility: granted\nScreen Recording: NOT granted\n',
        stderr: ''
      }
    })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('removes the managed server on unsupported platforms', async () => {
    const { ComputerUsePresenter } =
      await import('../../../src/main/presenter/computerUsePresenter')
    const mocks = createPresenterMocks()
    mocks.settings.set('computerUseEnabled', true)
    mocks.servers[COMPUTER_USE_SERVER_NAME] = {
      type: 'stdio',
      command: '/helper',
      args: ['mcp'],
      enabled: true
    }

    const presenter = new ComputerUsePresenter({
      configPresenter: mocks.configPresenter,
      mcpPresenter: mocks.mcpPresenter,
      platform: 'win32',
      isPackaged: true,
      appPath: tmpDir
    })

    await presenter.initialize()
    const status = await presenter.getStatus()

    expect(status.platform).toBe('unsupported')
    expect(status.enabled).toBe(false)
    expect(mocks.settings.get('computerUseEnabled')).toBe(false)
    expect(mocks.servers[COMPUTER_USE_SERVER_NAME]).toBeUndefined()
    expect(mocks.removeMcpServer).toHaveBeenCalledWith(COMPUTER_USE_SERVER_NAME)
  })

  it('resolves the packaged helper under app.asar.unpacked', async () => {
    const { ComputerUsePresenter } =
      await import('../../../src/main/presenter/computerUsePresenter')
    const mocks = createPresenterMocks()
    const presenter = new ComputerUsePresenter({
      configPresenter: mocks.configPresenter,
      mcpPresenter: mocks.mcpPresenter,
      platform: 'darwin',
      isPackaged: true,
      appPath: '/Applications/DeepChat.app/Contents/Resources/app.asar'
    })

    expect(presenter.resolveHelperPaths().helperBinaryPath).toBe(
      '/Applications/DeepChat.app/Contents/Resources/app.asar.unpacked/runtime/computer-use/cua-driver/current/DeepChat Computer Use.app/Contents/MacOS/cua-driver'
    )
  })

  it('uses the repository runtime path in development mode', async () => {
    const { ComputerUsePresenter } =
      await import('../../../src/main/presenter/computerUsePresenter')
    const mocks = createPresenterMocks()
    const presenter = new ComputerUsePresenter({
      configPresenter: mocks.configPresenter,
      mcpPresenter: mocks.mcpPresenter,
      platform: 'darwin',
      isPackaged: false,
      appPath: path.join(tmpDir, 'out', 'main')
    })

    expect(presenter.resolveHelperPaths().helperBinaryPath).toBe(
      path.join(
        process.cwd(),
        'runtime',
        'computer-use',
        'cua-driver',
        'current',
        'DeepChat Computer Use.app',
        'Contents',
        'MacOS',
        'cua-driver'
      )
    )
  })

  it('builds a locked-down MCP server config', async () => {
    const { ComputerUsePresenter } =
      await import('../../../src/main/presenter/computerUsePresenter')
    const mocks = createPresenterMocks()
    const presenter = new ComputerUsePresenter({
      configPresenter: mocks.configPresenter,
      mcpPresenter: mocks.mcpPresenter,
      platform: 'darwin',
      isPackaged: true,
      appPath: tmpDir
    })

    const config = presenter.buildMcpServerConfig('/helper/cua-driver')

    expect(config).toMatchObject({
      type: 'stdio',
      command: '/helper/cua-driver',
      args: ['mcp'],
      enabled: true,
      autoApprove: [],
      source: 'deepchat',
      sourceId: 'computer-use'
    })
    expect(config.env).toMatchObject({
      CUA_DRIVER_AUTO_UPDATE_ENABLED: '0',
      CUA_DRIVER_TELEMETRY_ENABLED: '0'
    })
  })

  it('registers and starts the helper when enabled on macOS', async () => {
    const { ComputerUsePresenter } =
      await import('../../../src/main/presenter/computerUsePresenter')
    const mocks = createPresenterMocks(true)
    const { helperBinaryPath } = await createHelper(tmpDir)
    const presenter = new ComputerUsePresenter({
      configPresenter: mocks.configPresenter,
      mcpPresenter: mocks.mcpPresenter,
      platform: 'darwin',
      arch: 'arm64',
      isPackaged: true,
      appPath: tmpDir
    })

    const status = await presenter.setEnabled(true)

    expect(status.enabled).toBe(true)
    expect(status.available).toBe(true)
    expect(status.helperVersion).toBe('0.0.5')
    expect(status.permissions).toEqual({
      accessibility: 'granted',
      screenRecording: 'missing'
    })
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      '/usr/bin/open',
      expect.arrayContaining([
        '-W',
        '-n',
        '-g',
        expect.stringContaining('DeepChat Computer Use.app'),
        '--args',
        'deepchat-permission-probe'
      ]),
      expect.objectContaining({ timeout: 10000 })
    )
    expect(mocks.addMcpServer).toHaveBeenCalledWith(
      COMPUTER_USE_SERVER_NAME,
      expect.objectContaining({
        command: helperBinaryPath,
        args: ['mcp'],
        source: 'deepchat',
        sourceId: 'computer-use'
      })
    )
    expect(mocks.startServer).toHaveBeenCalledWith(COMPUTER_USE_SERVER_NAME)
  })

  it('prompts through the helper app when opening the permission guide', async () => {
    const { ComputerUsePresenter } =
      await import('../../../src/main/presenter/computerUsePresenter')
    const mocks = createPresenterMocks(true)
    await createHelper(tmpDir)
    const presenter = new ComputerUsePresenter({
      configPresenter: mocks.configPresenter,
      mcpPresenter: mocks.mcpPresenter,
      platform: 'darwin',
      arch: 'arm64',
      isPackaged: true,
      appPath: tmpDir
    })

    await presenter.openPermissionGuide('accessibility')

    expect(execFileAsyncMock).toHaveBeenCalledWith(
      '/usr/bin/open',
      expect.arrayContaining([
        '-W',
        '-n',
        expect.stringContaining('DeepChat Computer Use.app'),
        '--args',
        'deepchat-permission-probe',
        '--prompt'
      ]),
      expect.objectContaining({ timeout: 10000 })
    )
  })

  it('keeps the user setting and reports missing helper when the binary is absent', async () => {
    const { ComputerUsePresenter } =
      await import('../../../src/main/presenter/computerUsePresenter')
    const mocks = createPresenterMocks(true)
    const presenter = new ComputerUsePresenter({
      configPresenter: mocks.configPresenter,
      mcpPresenter: mocks.mcpPresenter,
      platform: 'darwin',
      arch: 'arm64',
      isPackaged: true,
      appPath: tmpDir
    })

    const status = await presenter.setEnabled(true)

    expect(status.enabled).toBe(true)
    expect(status.available).toBe(false)
    expect(status.lastError).toBe('missingHelper')
    expect(mocks.settings.get('computerUseEnabled')).toBe(true)
    expect(mocks.addMcpServer).not.toHaveBeenCalled()
  })
})
