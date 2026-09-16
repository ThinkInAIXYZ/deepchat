import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('fs')
vi.unmock('node:fs')
vi.unmock('path')
vi.unmock('node:path')

import { PluginRemoteInstaller } from '@/plugin/remoteInstaller'
import { resetProbeCacheForTests, type FetchLike } from '@/toolchains/downloader'
import type {
  PluginCatalogArtifact,
  PluginCatalogInstallState,
  PluginCatalogTarget
} from '@shared/types/pluginCatalog'

const tempDirs: string[] = []
let stagingRootPath = ''

async function createStagingRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'deepchat-plugin-installer-'))
  tempDirs.push(dir)
  stagingRootPath = path.join(dir, 'staging')
  fs.mkdirSync(stagingRootPath, { recursive: true })
  return stagingRootPath
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
  resetProbeCacheForTests()
  vi.restoreAllMocks()
})

function createArtifactAndTarget(overrides: { url?: string; mirrors?: string[] }): {
  artifact: PluginCatalogArtifact
  target: PluginCatalogTarget
} {
  const artifact: PluginCatalogArtifact = {
    pluginId: 'com.deepchat.plugins.example',
    version: '1.0.0',
    channel: 'stable',
    targets: [
      {
        platform: 'darwin',
        arch: 'arm64',
        url: overrides.url ?? 'https://example.com/plugin.dcplugin',
        sha256: 'a'.repeat(64),
        size: 100,
        mirrors: overrides.mirrors ?? []
      }
    ]
  }
  return { artifact, target: artifact.targets[0] }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

type InstallerHarness = {
  installer: PluginRemoteInstaller
  installCalls: string[]
  states: PluginCatalogInstallState[]
}

function createHarness(options: {
  fetchImpl?: FetchLike
  installPackage?: (
    packagePath: string,
    expectedPluginId: string
  ) => Promise<{ pluginId: string; version: string }>
}): InstallerHarness {
  const states: PluginCatalogInstallState[] = []
  const installCalls: string[] = []
  const installer = new PluginRemoteInstaller({
    stagingRoot: () => stagingRootPath,
    installPackage:
      options.installPackage ??
      (async (packagePath: string, expectedPluginId: string) => {
        installCalls.push(packagePath)
        void expectedPluginId
        return {
          pluginId: 'com.deepchat.plugins.example',
          version: '1.0.0'
        }
      }),
    fetchImpl: options.fetchImpl,
    probeTimeoutMs: 250,
    onProgress: (state) => states.push(state)
  })
  return { installer, installCalls, states }
}

function fetchServingContent(content: string, failingUrls: Set<string> = new Set()): FetchLike {
  return async (url: string, init?: RequestInit) => {
    if (failingUrls.has(url)) {
      return new Response('not found', { status: 404 })
    }
    // Mirror requests carry the canonical URL as a path suffix; the response
    // content is the same regardless of which candidate serves it.
    void init
    return new Response(content, { status: 200 })
  }
}

describe('PluginRemoteInstaller', () => {
  it('downloads, verifies and installs through the install callback', async () => {
    await createStagingRoot()
    const content = 'plugin-package-bytes'
    const { artifact, target } = createArtifactAndTarget({})
    target.sha256 = sha256(content)
    const harness = createHarness({ fetchImpl: fetchServingContent(content) })

    const result = await harness.installer.install(artifact, target)

    expect(result.ok).toBe(true)
    expect(harness.installCalls).toHaveLength(1)
    const phases = harness.states.map((state) => state.phase)
    expect(phases).toContain('downloading')
    expect(phases[phases.length - 1]).toBe('installed')
    // Staging directory is cleaned up after a successful install.
    expect(fs.readdirSync(stagingRootPath)).toHaveLength(0)
  })

  it('rejects an artifact whose bytes do not match the pinned sha256', async () => {
    await createStagingRoot()
    const content = 'plugin-package-bytes'
    const { artifact, target } = createArtifactAndTarget({})
    target.sha256 = '0'.repeat(64)
    const harness = createHarness({ fetchImpl: fetchServingContent(content) })

    const result = await harness.installer.install(artifact, target)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('checksum_mismatch')
    expect(harness.installCalls).toHaveLength(0)
    expect(harness.installer.getInstallState(artifact.pluginId)?.phase).toBe('error')
    expect(fs.readdirSync(stagingRootPath)).toHaveLength(0)
  })

  it('prefers the fastest successful candidate and falls back to mirrors', async () => {
    await createStagingRoot()
    const content = 'mirrored-bytes'
    const directUrl = 'https://direct.example.com/plugin.dcplugin'
    const mirrorPrefix = 'https://mirror.example.com/proxy/'
    const { artifact, target } = createArtifactAndTarget({
      url: directUrl,
      mirrors: [mirrorPrefix]
    })
    target.sha256 = sha256(content)

    // The direct URL fails both probe and download; the mirror serves.
    const failing = new Set<string>([directUrl])
    const harness = createHarness({ fetchImpl: fetchServingContent(content, failing) })

    const result = await harness.installer.install(artifact, target)

    expect(result.ok).toBe(true)
    expect(harness.installCalls).toHaveLength(1)
  })

  it('still attempts the direct url when every probe fails', async () => {
    await createStagingRoot()
    const content = 'fallback-bytes'
    const directUrl = 'https://slow-probe.example.com/plugin.dcplugin'
    const { artifact, target } = createArtifactAndTarget({ url: directUrl })
    target.sha256 = sha256(content)

    let downloadAttempts = 0
    const fetchImpl: FetchLike = async (url: string, init?: RequestInit) => {
      const isProbe = init?.headers && 'Range' in (init.headers as Record<string, string>)
      if (isProbe) {
        return new Response('not found', { status: 404 })
      }
      downloadAttempts += 1
      expect(url).toBe(directUrl)
      return new Response(content, { status: 200 })
    }
    const harness = createHarness({ fetchImpl })

    const result = await harness.installer.install(artifact, target)

    expect(result.ok).toBe(true)
    expect(downloadAttempts).toBe(1)
  })

  it('reports cancelled when the download is aborted', async () => {
    await createStagingRoot()
    const { artifact, target } = createArtifactAndTarget({})
    // Each fetch call serves a fresh stream that stalls after one chunk and
    // errors when the request signal aborts, mirroring undici behavior.
    const fetchImpl: FetchLike = (_url: string, init?: RequestInit) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(streamController) {
            streamController.enqueue(new TextEncoder().encode('partial'))
            init?.signal?.addEventListener(
              'abort',
              () =>
                streamController.error(new DOMException('The operation was aborted', 'AbortError')),
              { once: true }
            )
          }
        }),
        { status: 200 }
      )
    const harness = createHarness({ fetchImpl })

    const controller = new AbortController()
    const installPromise = harness.installer.install(artifact, target, {
      signal: controller.signal
    })

    await vi.waitFor(() => {
      expect(harness.installer.getInstallState(artifact.pluginId)?.phase).toBe('downloading')
    })
    controller.abort()
    const result = await installPromise

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('cancelled')
    expect(harness.installer.getInstallState(artifact.pluginId)?.phase).toBe('cancelled')
    expect(harness.installCalls).toHaveLength(0)
  })

  it('rejects a second install while one is running', async () => {
    await createStagingRoot()
    const fetchImpl: FetchLike = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial'))
          }
        }),
        { status: 200 }
      )
    const harness = createHarness({ fetchImpl })
    const { artifact, target } = createArtifactAndTarget({})

    const first = harness.installer.install(artifact, target)
    const second = await harness.installer.install(artifact, target)

    expect(second.ok).toBe(false)
    expect(second.reason).toBe('busy')
    harness.installer.cancel(artifact.pluginId)
    const firstResult = await first
    expect(firstResult.ok).toBe(false)
    expect(firstResult.reason).toBe('cancelled')
  })

  it('fails when the installed package declares a different plugin id', async () => {
    await createStagingRoot()
    const content = 'package-bytes'
    const { artifact, target } = createArtifactAndTarget({})
    target.sha256 = sha256(content)
    const harness = createHarness({
      fetchImpl: fetchServingContent(content),
      installPackage: async () => ({
        pluginId: 'com.deepchat.plugins.other',
        version: '1.0.0'
      })
    })

    const result = await harness.installer.install(artifact, target)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('com.deepchat.plugins.other')
    expect(harness.installer.getInstallState(artifact.pluginId)?.phase).toBe('error')
  })
})
