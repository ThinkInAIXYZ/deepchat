import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')
import { NODE_MODULE_VERSION, NODE_PIN } from '../../../src/main/toolchains/catalog'
import { ToolchainResolutionError } from '../../../src/main/toolchains/errors'
import { inspectNodeExecutableResult, ToolchainService } from '../../../src/main/toolchains/service'

function writeExecutable(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, '')
  chmodSync(filePath, 0o755)
}

function seedNodeTree(rootDir: string, includeCorepack = true): void {
  writeExecutable(path.join(rootDir, 'bin', 'node'))
  writeExecutable(path.join(rootDir, 'bin', 'npm'))
  writeExecutable(path.join(rootDir, 'bin', 'npx'))
  if (includeCorepack) writeExecutable(path.join(rootDir, 'bin', 'corepack'))
}

function seedUvTree(rootDir: string): void {
  writeExecutable(path.join(rootDir, 'uv'))
  writeExecutable(path.join(rootDir, 'uvx'))
}

function createService(options?: {
  appPath?: string
  userDataDir?: string
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  onMissing?: (missing: { kind: string; reason: string }[]) => void
  onStateChanged?: () => void
  inspectNode?: () => { version: string; modules: number } | null
}): { service: ToolchainService; appPath: string; userDataDir: string } {
  const appPath = options?.appPath ?? mkdtempSync(path.join(os.tmpdir(), 'dc-app-'))
  const userDataDir = options?.userDataDir ?? mkdtempSync(path.join(os.tmpdir(), 'dc-data-'))
  const service = new ToolchainService({
    appPath,
    userDataDir,
    platform: options?.platform ?? 'darwin',
    env: options?.env ?? { PATH: '' },
    onStateChanged: options?.onStateChanged,
    inspectNode:
      options?.inspectNode ?? (() => ({ version: NODE_PIN, modules: NODE_MODULE_VERSION })),
    onMissing: options?.onMissing
  })
  return { service, appPath, userDataDir }
}

afterEach(() => {
  ToolchainService.resetForTests()
})

describe('ToolchainService', () => {
  it('derives a complete bundled tree without persisting it', () => {
    const { service, appPath, userDataDir } = createService()
    seedNodeTree(path.join(appPath, 'runtime', 'node'), false)
    seedUvTree(path.join(appPath, 'runtime', 'uv'))

    const state = service.getState()
    expect(state.node).toEqual({ source: 'bundled' })
    expect(state.uv).toEqual({ source: 'bundled' })
    expect(service.resolve('node').node).toBe(path.join(appPath, 'runtime', 'node', 'bin', 'node'))
    expect(service.resolve('uv').uv).toBe(path.join(appPath, 'runtime', 'uv', 'uv'))
    expect(existsSync(path.join(userDataDir, 'toolchains', 'state.json'))).toBe(false)
  })

  it('migrates to system when bundled files are absent and PATH is complete', () => {
    const systemRoot = mkdtempSync(path.join(os.tmpdir(), 'dc-sys-'))
    seedNodeTree(systemRoot, false)
    seedUvTree(systemRoot)
    const { service } = createService({
      env: { PATH: path.join(systemRoot, 'bin') + ':' + systemRoot }
    })

    expect(service.getState().node).toEqual({ source: 'system' })
    expect(service.getState().uv).toEqual({ source: 'system' })
    expect(service.resolve('node').node).toBe(path.join(systemRoot, 'bin', 'node'))
  })

  it('clears a source back to derived defaults', () => {
    const { service, appPath, userDataDir } = createService()
    seedNodeTree(path.join(appPath, 'runtime', 'node'), false)
    service.setSource('node', { source: 'bundled' })
    expect(service.getStatus().node.derived).toBe(false)

    service.setSource('node', { source: 'unconfigured' })
    const persisted = JSON.parse(
      readFileSync(path.join(userDataDir, 'toolchains', 'state.json'), 'utf8')
    )
    expect(persisted.node).toBeUndefined()
    expect(service.getState().node).toEqual({ source: 'bundled' })
    expect(service.getStatus().node.derived).toBe(true)
    expect(service.resolve('node').source).toBe('bundled')
  })

  it('rejects a half-installed bundled Node instead of rewriting to a missing npx', () => {
    const { service, appPath } = createService()
    writeExecutable(path.join(appPath, 'runtime', 'node', 'bin', 'node'))
    expect(service.getState().node.source).toBe('unconfigured')

    service.setSource('node', { source: 'bundled' })
    expect(() => service.resolve('node')).toThrow(/missing npm or npx/)
  })

  it('does not walk from a persisted bundled source to system when bundled files disappear', () => {
    const { service, appPath, userDataDir } = createService()
    seedNodeTree(path.join(appPath, 'runtime', 'node'), false)
    service.setSource('node', { source: 'bundled' })
    expect(service.resolve('node').source).toBe('bundled')

    const emptyApp = mkdtempSync(path.join(os.tmpdir(), 'dc-empty-'))
    const systemRoot = mkdtempSync(path.join(os.tmpdir(), 'dc-sys-'))
    seedNodeTree(systemRoot, false)
    const reloaded = new ToolchainService({
      appPath: emptyApp,
      userDataDir,
      platform: 'darwin',
      env: { PATH: path.join(systemRoot, 'bin') },
      inspectNode: () => ({ version: NODE_PIN, modules: NODE_MODULE_VERSION })
    })

    expect(reloaded.getState().node.source).toBe('bundled')
    expect(() => reloaded.resolve('node')).toThrow(/missing/)
  })

  it('re-derives a bundled tree after first-run when nothing was persisted', () => {
    const { service, appPath, userDataDir } = createService()
    expect(service.getState().node.source).toBe('unconfigured')

    seedNodeTree(path.join(appPath, 'runtime', 'node'), false)
    const reloaded = new ToolchainService({
      appPath,
      userDataDir,
      platform: 'darwin',
      env: { PATH: '' },
      inspectNode: () => ({ version: NODE_PIN, modules: NODE_MODULE_VERSION })
    })
    expect(reloaded.getState().node.source).toBe('bundled')
  })

  it('rewrites node and uv commands to resolved absolute paths', () => {
    const { service, appPath } = createService()
    seedNodeTree(path.join(appPath, 'runtime', 'node'), false)
    seedUvTree(path.join(appPath, 'runtime', 'uv'))

    expect(service.rewriteCommand('npx', ['-y', 'server'])).toEqual({
      command: path.join(appPath, 'runtime', 'node', 'bin', 'npx'),
      args: ['-y', 'server']
    })
    expect(service.rewriteCommand('uvx', ['tool'])).toEqual({
      command: path.join(appPath, 'runtime', 'uv', 'uvx'),
      args: ['tool']
    })
    expect(service.rewriteCommand('python', ['app.py'])).toEqual({
      command: 'python',
      args: ['app.py']
    })
    expect(service.rewriteCommand('npx', ['server', path.join('/Users/me', 'node')])).toEqual({
      command: path.join(appPath, 'runtime', 'node', 'bin', 'npx'),
      args: ['server', path.join('/Users/me', 'node')]
    })
  })

  it('does not mark node missing when only uv is prepended', () => {
    const { service, appPath } = createService()
    seedUvTree(path.join(appPath, 'runtime', 'uv'))

    expect(service.prependResolvedToEnv({ PATH: '/bin' }).PATH).toContain(
      path.join(appPath, 'runtime', 'uv')
    )
    expect(service.getStatus().missing).toEqual([])
  })

  it('clears the missing banner after a later successful resolve', () => {
    const notices: Array<Array<{ kind: string; reason: string }>> = []
    const { service, appPath } = createService({
      onMissing: (missing) => notices.push(missing)
    })
    expect(() => service.resolve('node')).toThrow(/not configured/)
    expect(notices.at(-1)).toEqual([{ kind: 'node', reason: 'unconfigured' }])

    seedNodeTree(path.join(appPath, 'runtime', 'node'), false)
    service.setSource('node', { source: 'bundled' })
    service.resolve('node')
    expect(notices.at(-1)).toEqual([])
  })

  it('keeps an OCR pin failure after a generic node resolve succeeds', () => {
    const systemRoot = mkdtempSync(path.join(os.tmpdir(), 'dc-sys-'))
    seedNodeTree(systemRoot, false)
    const ocrService = new ToolchainService({
      appPath: mkdtempSync(path.join(os.tmpdir(), 'dc-empty-')),
      userDataDir: mkdtempSync(path.join(os.tmpdir(), 'dc-data-')),
      platform: 'darwin',
      env: { PATH: path.join(systemRoot, 'bin') },
      inspectNode: () => ({ version: 'v22.14.0', modules: 127 })
    })

    expect(() => ocrService.resolve('node', { purpose: 'ocr' })).toThrow(/compatibility range/)
    expect(ocrService.resolve('node').node).toBe(path.join(systemRoot, 'bin', 'node'))
    expect(ocrService.getStatus().missing).toEqual([{ kind: 'node', reason: 'version_mismatch' }])
  })

  it('enforces the OCR official ABI pin', () => {
    const { service, appPath } = createService()
    seedNodeTree(path.join(appPath, 'runtime', 'node'), false)
    const resolved = service.resolve('node', { purpose: 'ocr' })
    expect(resolved.version).toBe(NODE_PIN)
    expect(resolved.nodeModuleVersion).toBe(NODE_MODULE_VERSION)

    const systemRoot = mkdtempSync(path.join(os.tmpdir(), 'dc-old-'))
    seedNodeTree(systemRoot, false)
    const systemService = new ToolchainService({
      appPath: mkdtempSync(path.join(os.tmpdir(), 'dc-empty-')),
      userDataDir: mkdtempSync(path.join(os.tmpdir(), 'dc-data-')),
      platform: 'darwin',
      env: { PATH: path.join(systemRoot, 'bin') },
      inspectNode: () => ({ version: 'v22.14.0', modules: 127 })
    })
    expect(() => systemService.resolve('node', { purpose: 'ocr' })).toThrow(/compatibility range/)
  })

  it('quarantines unreadable state instead of overwriting it in place', () => {
    const { userDataDir } = createService()
    const statePath = path.join(userDataDir, 'toolchains', 'state.json')
    mkdirSync(path.dirname(statePath), { recursive: true })
    writeFileSync(statePath, '{not-json')

    const reloaded = new ToolchainService({
      appPath: mkdtempSync(path.join(os.tmpdir(), 'dc-empty-')),
      userDataDir,
      platform: 'darwin',
      env: { PATH: '' },
      inspectNode: () => ({ version: NODE_PIN, modules: NODE_MODULE_VERSION })
    })

    expect(reloaded.getState().node.source).toBe('unconfigured')
    expect(readFileSync(`${statePath}.corrupt`, 'utf8')).toBe('{not-json')
  })

  it('does not re-inspect a failed system Node until persist', () => {
    const systemRoot = mkdtempSync(path.join(os.tmpdir(), 'dc-sys-'))
    seedNodeTree(systemRoot, false)
    let inspections = 0
    const { service } = createService({
      env: { PATH: path.join(systemRoot, 'bin') },
      inspectNode: () => {
        inspections += 1
        return null
      }
    })

    expect(service.getState().node.source).toBe('system')
    service.getStatus()
    service.getStatus()
    expect(inspections).toBe(1)

    service.setSource('node', { source: 'system' })
    service.getStatus()
    expect(inspections).toBe(2)
  })

  it('re-derives missing kinds after login-shell PATH arrives', () => {
    const notices: Array<Array<{ kind: string; reason: string }>> = []
    const { service, userDataDir } = createService({
      env: { PATH: '' },
      onMissing: (missing) => notices.push(missing)
    })
    expect(service.getState()).toEqual({
      schemaVersion: 1,
      node: { source: 'unconfigured' },
      uv: { source: 'unconfigured' }
    })
    expect(() => service.resolve('node')).toThrow(/not configured/)
    expect(notices.at(-1)).toEqual([{ kind: 'node', reason: 'unconfigured' }])
    expect(existsSync(path.join(userDataDir, 'toolchains', 'state.json'))).toBe(false)

    const systemRoot = mkdtempSync(path.join(os.tmpdir(), 'dc-sys-'))
    seedNodeTree(systemRoot, false)
    seedUvTree(systemRoot)
    service.updateDetectionEnv({
      PATH: `${path.join(systemRoot, 'bin')}:${systemRoot}`
    })

    expect(service.getState()).toEqual({
      schemaVersion: 1,
      node: { source: 'system' },
      uv: { source: 'system' }
    })
    expect(service.resolve('node').node).toBe(path.join(systemRoot, 'bin', 'node'))
    expect(notices.at(-1)).toEqual([])
  })

  it('does not overwrite an explicit source when PATH arrives', () => {
    const { service, appPath } = createService({ env: { PATH: '' } })
    seedNodeTree(path.join(appPath, 'runtime', 'node'), false)
    service.setSource('node', { source: 'bundled' })

    const systemRoot = mkdtempSync(path.join(os.tmpdir(), 'dc-sys-'))
    seedNodeTree(systemRoot, false)
    seedUvTree(systemRoot)
    service.updateDetectionEnv({
      PATH: `${path.join(systemRoot, 'bin')}:${systemRoot}`
    })
    expect(service.getState().node.source).toBe('bundled')
    expect(service.getState().uv.source).toBe('system')
  })

  it('ignores a provisional state file and treats kinds independently', () => {
    const { appPath, userDataDir } = createService()
    const statePath = path.join(userDataDir, 'toolchains', 'state.json')
    mkdirSync(path.dirname(statePath), { recursive: true })
    writeFileSync(
      statePath,
      JSON.stringify({
        schemaVersion: 1,
        provisional: true,
        node: { source: 'system' },
        uv: { source: 'system' }
      })
    )
    const service = new ToolchainService({
      appPath,
      userDataDir,
      platform: 'darwin',
      env: { PATH: '' },
      inspectNode: () => ({ version: NODE_PIN, modules: NODE_MODULE_VERSION })
    })
    expect(service.getState()).toEqual({
      schemaVersion: 1,
      node: { source: 'unconfigured' },
      uv: { source: 'unconfigured' }
    })
  })

  it('keeps a missing notice when clearing leaves no derived source', () => {
    const notices: Array<Array<{ kind: string; reason: string }>> = []
    const { service } = createService({
      onMissing: (missing) => notices.push(missing)
    })
    service.setSource('node', { source: 'unconfigured' })
    expect(notices.at(-1)).toEqual([{ kind: 'node', reason: 'unconfigured' }])
    expect(service.getStatus().missing).toEqual([{ kind: 'node', reason: 'unconfigured' }])
    expect(service.getStatus().node.derived).toBe(true)
  })

  it('rememoizes a derived source after PATH refresh', () => {
    const { service } = createService({ env: { PATH: '' } })
    expect(service.getStatus().node).toMatchObject({
      selection: { source: 'unconfigured' },
      derived: true
    })

    const systemRoot = mkdtempSync(path.join(os.tmpdir(), 'dc-sys-'))
    seedNodeTree(systemRoot, false)
    service.updateDetectionEnv({ PATH: path.join(systemRoot, 'bin') })
    expect(service.getStatus().node).toMatchObject({
      selection: { source: 'system' },
      derived: true
    })
  })

  it('reuses a timed-out Node inspection within the TTL', () => {
    const systemRoot = mkdtempSync(path.join(os.tmpdir(), 'dc-sys-'))
    seedNodeTree(systemRoot, false)
    let inspections = 0
    const service = new ToolchainService({
      appPath: mkdtempSync(path.join(os.tmpdir(), 'dc-empty-')),
      userDataDir: mkdtempSync(path.join(os.tmpdir(), 'dc-data-')),
      platform: 'darwin',
      env: { PATH: path.join(systemRoot, 'bin') },
      inspectNode: () => {
        inspections += 1
        return undefined
      }
    })
    service.getStatus()
    expect(inspections).toBeGreaterThan(0)
    const afterFirst = inspections
    service.getStatus()
    expect(inspections).toBe(afterFirst)
  })

  it('throws transient instead of abi_mismatch when Node inspection times out', () => {
    const systemRoot = mkdtempSync(path.join(os.tmpdir(), 'dc-sys-'))
    seedNodeTree(systemRoot, false)
    const service = new ToolchainService({
      appPath: mkdtempSync(path.join(os.tmpdir(), 'dc-empty-')),
      userDataDir: mkdtempSync(path.join(os.tmpdir(), 'dc-data-')),
      platform: 'darwin',
      env: { PATH: path.join(systemRoot, 'bin') },
      inspectNode: () => undefined
    })
    expect(() => service.resolve('node', { purpose: 'ocr' })).toThrow(ToolchainResolutionError)
    try {
      service.resolve('node', { purpose: 'ocr' })
    } catch (error) {
      expect(error).toMatchObject({ reason: 'transient' })
    }
    expect(service.getStatus().missing).toEqual([])
  })

  it.skipIf(process.platform === 'win32')('treats a hung inspect spawn as retryable', () => {
    const script = path.join(mkdtempSync(path.join(os.tmpdir(), 'dc-hang-')), 'hang')
    writeFileSync(script, '#!/bin/sh\nsleep 1\n')
    chmodSync(script, 0o755)
    const result = inspectNodeExecutableResult(script, 40)
    expect(result.retryable).toBe(true)
    expect(result.inspection).toBeNull()
  })

  it('requires corepack only for managed Node', () => {
    const { service, userDataDir } = createService()
    const managedRoot = path.join(userDataDir, 'toolchains', 'node', 'v24.18.0')
    seedNodeTree(managedRoot, false)
    service.setSource('node', { source: 'managed', version: 'v24.18.0' })
    expect(() => service.resolve('node')).toThrow(ToolchainResolutionError)

    writeExecutable(path.join(managedRoot, 'bin', 'corepack'))
    const resolved = service.resolve('node')
    expect(resolved.source).toBe('managed')
    expect(resolved.corepack).toBe(path.join(managedRoot, 'bin', 'corepack'))
  })

  it('keeps a custom path that points inside a managed tree', () => {
    const { service, userDataDir } = createService()
    const pin = path.join(userDataDir, 'toolchains', 'node', 'v24.18.0')
    const previous = path.join(userDataDir, 'toolchains', 'node', 'v22.14.0')
    seedNodeTree(pin)
    seedNodeTree(previous)
    service.setSource('node', {
      source: 'custom',
      customPath: path.join(previous, 'bin', 'node')
    })

    service.gcUnreachableTrees()
    expect(existsSync(previous)).toBe(true)
    expect(existsSync(pin)).toBe(true)
  })

  it('still collects an unused managed version when custom path is outside', () => {
    const { service, userDataDir } = createService()
    const pin = path.join(userDataDir, 'toolchains', 'node', 'v24.18.0')
    const previous = path.join(userDataDir, 'toolchains', 'node', 'v22.14.0')
    const outside = mkdtempSync(path.join(os.tmpdir(), 'dc-custom-'))
    seedNodeTree(pin)
    seedNodeTree(previous)
    seedNodeTree(outside, false)
    service.setSource('node', {
      source: 'custom',
      customPath: path.join(outside, 'bin', 'node')
    })

    service.gcUnreachableTrees()
    expect(existsSync(previous)).toBe(false)
    expect(existsSync(pin)).toBe(true)
  })

  it('writes the same Windows PATH value to both casings and drops leftover path', () => {
    const { service, appPath } = createService({ platform: 'win32' })
    const uvRoot = path.join(appPath, 'runtime', 'uv')
    writeExecutable(path.join(uvRoot, 'uv.exe'))
    writeExecutable(path.join(uvRoot, 'uvx.exe'))
    const env = service.prependResolvedToEnv({
      Path: 'C:\\user\\bin',
      path: 'C:\\legacy\\bin'
    })
    expect(env.PATH).toBe(env.Path)
    expect(env.path).toBeUndefined()
    expect(env.Path?.split(';')[0]).toBe(uvRoot)
    expect(env.Path).toContain('C:\\user\\bin')
  })

  it('notifies a state change after an explicit source change', () => {
    let changed = 0
    const { service, appPath } = createService({
      onStateChanged: () => {
        changed += 1
      }
    })
    seedNodeTree(path.join(appPath, 'runtime', 'node'), false)
    service.setSource('node', { source: 'bundled' })
    expect(changed).toBe(1)
  })
})
