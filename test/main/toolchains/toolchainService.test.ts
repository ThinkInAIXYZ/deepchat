import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')
import { NODE_MODULE_VERSION, NODE_PIN } from '../../../src/main/toolchains/catalog'
import { ToolchainResolutionError } from '../../../src/main/toolchains/errors'
import { ToolchainService } from '../../../src/main/toolchains/service'

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
  env?: NodeJS.ProcessEnv
}): { service: ToolchainService; appPath: string; userDataDir: string } {
  const appPath = options?.appPath ?? mkdtempSync(path.join(os.tmpdir(), 'dc-app-'))
  const userDataDir = options?.userDataDir ?? mkdtempSync(path.join(os.tmpdir(), 'dc-data-'))
  const service = new ToolchainService({
    appPath,
    userDataDir,
    platform: 'darwin',
    env: options?.env ?? { PATH: '' },
    inspectNode: () => ({ version: NODE_PIN, modules: NODE_MODULE_VERSION })
  })
  return { service, appPath, userDataDir }
}

afterEach(() => {
  ToolchainService.resetForTests()
})

describe('ToolchainService', () => {
  it('migrates a complete bundled tree to an explicit bundled source', () => {
    const { service, appPath } = createService()
    seedNodeTree(path.join(appPath, 'runtime', 'node'), false)
    seedUvTree(path.join(appPath, 'runtime', 'uv'))

    const state = service.getState()
    expect(state.node).toEqual({ source: 'bundled' })
    expect(state.uv).toEqual({ source: 'bundled' })
    expect(service.resolve('node').node).toBe(path.join(appPath, 'runtime', 'node', 'bin', 'node'))
    expect(service.resolve('uv').uv).toBe(path.join(appPath, 'runtime', 'uv', 'uv'))
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

  it('stays unconfigured when nothing is available and does not switch later', () => {
    const { service, appPath } = createService()
    expect(service.getState().node.source).toBe('unconfigured')
    expect(() => service.resolve('node')).toThrow(ToolchainResolutionError)

    seedNodeTree(path.join(appPath, 'runtime', 'node'), false)
    expect(() => service.resolve('node')).toThrow(/not configured/)
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

  it('persists the first-run source and ignores a later bundled install', () => {
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
    expect(reloaded.getState().node.source).toBe('unconfigured')
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
    const { service, userDataDir } = createService()
    service.getState()
    const statePath = path.join(userDataDir, 'toolchains', 'state.json')
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
})
