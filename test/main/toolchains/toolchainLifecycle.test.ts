import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import * as catalog from '../../../src/main/toolchains/catalog'
import { NODE_MODULE_VERSION, NODE_PIN } from '../../../src/main/toolchains/catalog'
import { ToolchainDownloadError } from '../../../src/main/toolchains/errors'
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

function sha256(payload: Buffer): string {
  return createHash('sha256').update(payload).digest('hex')
}

function createFetch(payload: Buffer) {
  return async (_url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range
    if (range === 'bytes=0-0') {
      return new Response(payload.subarray(0, 1), { status: 206 })
    }
    return new Response(payload, {
      status: 200,
      headers: { 'content-length': String(payload.length) }
    })
  }
}

afterEach(() => {
  ToolchainService.resetForTests()
  vi.restoreAllMocks()
})

describe('ToolchainService lifecycle', () => {
  it('leaves the previous working source active when extraction fails', async () => {
    const appPath = mkdtempSync(path.join(os.tmpdir(), 'dc-app-'))
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'dc-data-'))
    seedNodeTree(path.join(appPath, 'runtime', 'node'), false)
    const payload = Buffer.from('node-archive')
    vi.spyOn(catalog, 'resolveToolchainArtifact').mockReturnValue({
      ...catalog.resolveToolchainArtifact('node', 'darwin', 'arm64'),
      sha256: sha256(payload)
    })
    const service = new ToolchainService({
      appPath,
      userDataDir,
      platform: 'darwin',
      arch: 'arm64',
      env: { PATH: '' },
      inspectNode: () => ({ version: NODE_PIN, modules: NODE_MODULE_VERSION }),
      fetch: createFetch(payload),
      extractArchive: async () => {
        throw new Error('extract exploded')
      }
    })

    expect(service.getState().node.source).toBe('bundled')
    await expect(service.install('node')).rejects.toBeInstanceOf(ToolchainDownloadError)
    expect(service.getState().node.source).toBe('bundled')
    expect(service.resolve('node').source).toBe('bundled')
  })

  it('activates the official Node pin after a complete download', async () => {
    const appPath = mkdtempSync(path.join(os.tmpdir(), 'dc-app-'))
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'dc-data-'))
    const payload = Buffer.from('complete-node-archive-bytes')
    vi.spyOn(catalog, 'resolveToolchainArtifact').mockReturnValue({
      ...catalog.resolveToolchainArtifact('node', 'darwin', 'arm64'),
      sha256: sha256(payload)
    })
    const service = new ToolchainService({
      appPath,
      userDataDir,
      platform: 'darwin',
      arch: 'arm64',
      env: { PATH: '' },
      inspectNode: () => ({ version: NODE_PIN, modules: NODE_MODULE_VERSION }),
      fetch: createFetch(payload),
      extractArchive: async (_archive, destDir) => {
        seedNodeTree(destDir, true)
      }
    })

    await service.install('node')
    expect(service.getState().node).toEqual({ source: 'managed', version: NODE_PIN })
    expect(service.resolve('node').corepack).toContain(`${path.sep}corepack`)
    expect(service.getStatus().node.availability).toBe('ready')
  })

  it('reverts uv to the bundled seed and does not auto-pick system Node', () => {
    const appPath = mkdtempSync(path.join(os.tmpdir(), 'dc-app-'))
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'dc-data-'))
    seedUvTree(path.join(appPath, 'runtime', 'uv'))
    const service = new ToolchainService({
      appPath,
      userDataDir,
      platform: 'darwin',
      env: { PATH: '' },
      inspectNode: () => ({ version: NODE_PIN, modules: NODE_MODULE_VERSION })
    })

    service.setSource('uv', { source: 'managed', version: '0.9.18' })
    expect(service.revert('uv').uv.source).toBe('bundled')
    expect(service.revert('node').node.source).toBe('unconfigured')
  })

  it('shares one in-flight install per kind', async () => {
    const appPath = mkdtempSync(path.join(os.tmpdir(), 'dc-app-'))
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'dc-data-'))
    const payload = Buffer.from('uv-bytes')
    let extracts = 0
    vi.spyOn(catalog, 'resolveToolchainArtifact').mockReturnValue({
      ...catalog.resolveToolchainArtifact('uv', 'darwin', 'arm64'),
      sha256: sha256(payload)
    })
    const service = new ToolchainService({
      appPath,
      userDataDir,
      platform: 'darwin',
      arch: 'arm64',
      env: { PATH: '' },
      fetch: createFetch(payload),
      extractArchive: async (_archive, destDir) => {
        extracts += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        seedUvTree(destDir)
      }
    })

    await Promise.all([service.install('uv'), service.install('uv')])
    expect(extracts).toBe(1)
    expect(service.getState().uv).toEqual({ source: 'managed', version: '0.9.18' })
  })

  it('repairs a managed tree without rewriting a system source', async () => {
    const appPath = mkdtempSync(path.join(os.tmpdir(), 'dc-app-'))
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'dc-data-'))
    const systemRoot = mkdtempSync(path.join(os.tmpdir(), 'dc-sys-'))
    seedNodeTree(systemRoot, false)
    const payload = Buffer.from('repair-node-archive')
    const artifact = {
      ...catalog.resolveToolchainArtifact('node', 'darwin', 'arm64'),
      sha256: sha256(payload)
    }
    vi.spyOn(catalog, 'resolveToolchainArtifact').mockReturnValue(artifact)
    const service = new ToolchainService({
      appPath,
      userDataDir,
      platform: 'darwin',
      arch: 'arm64',
      env: { PATH: path.join(systemRoot, 'bin') },
      inspectNode: () => ({ version: NODE_PIN, modules: NODE_MODULE_VERSION }),
      fetch: createFetch(payload),
      extractArchive: async (_archive, destDir) => {
        seedNodeTree(destDir, true)
      }
    })

    expect(service.getState().node.source).toBe('system')
    await expect(service.repair('node')).rejects.toMatchObject({ reason: 'path_invalid' })
    expect(service.getState().node.source).toBe('system')

    await service.install('node')
    expect(service.getState().node).toEqual({ source: 'managed', version: NODE_PIN })
    vi.mocked(catalog.resolveToolchainArtifact).mockReturnValue({
      ...artifact,
      version: 'v24.19.0'
    })
    await service.repair('node')
    expect(service.getState().node).toEqual({ source: 'managed', version: 'v24.19.0' })
  })

  it('retries extract from a verified archive without re-downloading', async () => {
    const appPath = mkdtempSync(path.join(os.tmpdir(), 'dc-app-'))
    const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'dc-data-'))
    const payload = Buffer.from('retry-node-archive-bytes')
    let downloads = 0
    let extracts = 0
    vi.spyOn(catalog, 'resolveToolchainArtifact').mockReturnValue({
      ...catalog.resolveToolchainArtifact('node', 'darwin', 'arm64'),
      sha256: sha256(payload)
    })
    const service = new ToolchainService({
      appPath,
      userDataDir,
      platform: 'darwin',
      arch: 'arm64',
      env: { PATH: '' },
      inspectNode: () => ({ version: NODE_PIN, modules: NODE_MODULE_VERSION }),
      fetch: async (url, init) => {
        const range = (init?.headers as Record<string, string> | undefined)?.Range
        if (range !== 'bytes=0-0') downloads += 1
        return createFetch(payload)(url, init)
      },
      extractArchive: async (_archive, destDir) => {
        extracts += 1
        if (extracts === 1) throw new Error('extract exploded')
        seedNodeTree(destDir, true)
      }
    })

    await expect(service.install('node')).rejects.toBeInstanceOf(ToolchainDownloadError)
    await service.install('node')
    expect(downloads).toBe(1)
    expect(extracts).toBe(2)
    expect(service.getState().node).toEqual({ source: 'managed', version: NODE_PIN })
  })

  it('surfaces a missing notice when resolve fails', () => {
    const service = new ToolchainService({
      appPath: mkdtempSync(path.join(os.tmpdir(), 'dc-app-')),
      userDataDir: mkdtempSync(path.join(os.tmpdir(), 'dc-data-')),
      platform: 'darwin',
      env: { PATH: '' }
    })
    expect(() => service.resolve('node')).toThrow(/not configured/)
    expect(service.getStatus().missing).toEqual([{ kind: 'node', reason: 'unconfigured' }])
  })
})
