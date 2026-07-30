import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'

import { parseCuaRuntimeIntegrityDescriptor } from '@/plugin/cuaRuntimeIntegrity'

const ROOT = process.cwd()
const tempRoots: string[] = []
const DARWIN_HELPER_APP = 'DeepChat Computer Use.app'
const DARWIN_HELPER_EXECUTABLE = 'deepchat-cua-driver'
const DARWIN_HELPER_BUNDLE_ID = 'com.deepchat.computeruse.helper'

function darwinInfoPlist({
  bundleId = DARWIN_HELPER_BUNDLE_ID,
  executable = DARWIN_HELPER_EXECUTABLE
} = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleIdentifier</key>
    <string>${bundleId}</string>
    <key>CFBundleName</key>
    <string>DeepChat Computer Use</string>
    <key>CFBundleDisplayName</key>
    <string>DeepChat Computer Use</string>
    <key>CFBundleExecutable</key>
    <string>${executable}</string>
  </dict>
</plist>
`
}

async function createCuaPluginFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-package-plugin-'))
  tempRoots.push(root)
  const pluginDir = path.join(root, 'cua')
  const runtimeTargets = ['x64', 'arm64']
  const manifest = {
    id: 'com.deepchat.plugins.cua',
    name: 'Computer Use',
    version: '0.0.0',
    publisher: 'DeepChat',
    engines: {
      deepchat: '>=0.0.0',
      platforms: ['darwin', 'win32', 'linux'],
      targets: ['darwin/arm64', 'darwin/x64', 'win32/x64', 'win32/arm64', 'linux/x64']
    },
    activationEvents: ['onEnable'],
    capabilities: ['runtime.manage', 'mcp.register'],
    source: {
      type: 'deepchat-official',
      url: '${github.release.download}/deepchat-plugin-cua-${app.version}-${target.platform}-${arch}.dcplugin',
      publisher: 'DeepChat'
    },
    runtime: {
      id: 'cua-driver',
      type: 'external-helper',
      displayName: 'CUA Driver',
      adapter: 'cua-embedded-v1',
      integrityDescriptor: 'runtime/${target.platform}/${arch}/integrity.json',
      adapterContract: {
        hostBundleId: 'com.wefonk.deepchat',
        driverVersion: '0.14.1',
        contractVersion: '0.2.0',
        toolsListSchemaVersion: '1',
        capabilityVersion: '1',
        mcpProtocolVersion: '2025-06-18'
      },
      detect: [
        'app-helper:DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver',
        'plugin:runtime/darwin/${arch}/DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver',
        'plugin:runtime/win32/${arch}/cua-driver.exe',
        'plugin:runtime/linux/${arch}/cua-driver'
      ]
    },
    mcpServers: [
      {
        id: 'cua-driver',
        displayName: 'CUA Driver',
        transport: 'stdio',
        command: '${runtime.cua-driver.command}',
        args: ['mcp', '--embedded'],
        startMode: 'onDemand',
        surfaces: ['tools'],
        toolCatalog: 'runtime/${target.platform}/${arch}/tool-catalog.json',
        inheritEnv: 'minimal'
      }
    ],
    toolPolicies: [
      {
        serverId: 'cua-driver',
        tools: {
          check_permissions: 'allow'
        }
      }
    ]
  }
  const toolCatalog = `${JSON.stringify(
    {
      version: '0.14.1',
      tools: [
        {
          name: 'check_permissions',
          description: 'Check native permissions.',
          input_schema: {
            type: 'object',
            properties: {},
            required: []
          },
          read_only: false,
          destructive: false,
          idempotent: true
        }
      ]
    },
    null,
    2
  )}\n`

  await mkdir(pluginDir, { recursive: true })
  await writeFile(path.join(pluginDir, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  for (const arch of runtimeTargets) {
    const darwinAppDir = path.join(pluginDir, 'runtime', 'darwin', arch, DARWIN_HELPER_APP)
    const darwinExecutable = path.join(
      darwinAppDir,
      'Contents',
      'MacOS',
      DARWIN_HELPER_EXECUTABLE
    )
    await mkdir(path.dirname(darwinExecutable), { recursive: true })
    await mkdir(path.join(darwinAppDir, 'Contents'), { recursive: true })
    await writeFile(path.join(darwinAppDir, 'Contents', 'Info.plist'), darwinInfoPlist())
    await writeFile(darwinExecutable, 'driver')
    await writeFile(path.join(pluginDir, 'runtime', 'darwin', arch, 'tool-catalog.json'), toolCatalog)
    await chmod(darwinExecutable, 0o755)

    const runtimeDir = path.join(pluginDir, 'runtime', 'win32', arch)
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(path.join(runtimeDir, 'cua-driver.exe'), 'driver')
    await writeFile(path.join(runtimeDir, 'tool-catalog.json'), toolCatalog)
  }
  const linuxRuntimeDir = path.join(pluginDir, 'runtime', 'linux', 'x64')
  const linuxExecutable = path.join(linuxRuntimeDir, 'cua-driver')
  await mkdir(linuxRuntimeDir, { recursive: true })
  await writeFile(linuxExecutable, 'driver')
  await writeFile(path.join(linuxRuntimeDir, 'tool-catalog.json'), toolCatalog)
  await chmod(linuxExecutable, 0o755)

  return { root, pluginDir }
}

function runPackagePlugin(
  pluginDir: string,
  outDir: string,
  platform: string,
  arch: string,
  options: { purpose?: string; env?: NodeJS.ProcessEnv } = {}
) {
  const purposeArgs = options.purpose ? ['--purpose', options.purpose] : []
  return spawnSync(
    process.execPath,
    [
      'scripts/package-plugin.mjs',
      '--out',
      outDir,
      '--target-platform',
      platform,
      '--target-arch',
      arch,
      ...purposeArgs,
      pluginDir
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PACKAGE_PURPOSE: options.purpose ?? '',
        ...options.env
      }
    }
  )
}

describe('package-plugin', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('scopes packaged target metadata to the selected CUA artifact target', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'win32', 'arm64')

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout)
    }
    const artifactPath = path.join(outDir, 'deepchat-plugin-cua-0.0.0-win32-arm64.dcplugin')
    const files = unzipSync(new Uint8Array(await readFile(artifactPath)))
    const manifest = JSON.parse(Buffer.from(files['plugin.json']).toString('utf8'))

    expect(manifest.engines.targets).toEqual(['win32/arm64'])
    expect(manifest.source.url).toContain('deepchat-plugin-cua-0.0.0-win32-arm64.dcplugin')
    expect(manifest.mcpServers[0].args).toEqual(['mcp', '--embedded'])
    expect(manifest.mcpServers[0]).not.toHaveProperty('env')
    expect(Object.keys(files).filter((file) => file.startsWith('runtime/')).sort()).toEqual([
      'runtime/win32/arm64/cua-driver.exe',
      'runtime/win32/arm64/integrity.json',
      'runtime/win32/arm64/tool-catalog.json'
    ])
    const integrity = JSON.parse(
      Buffer.from(files['runtime/win32/arm64/integrity.json']).toString('utf8')
    )
    expect(integrity).toMatchObject({
      schemaVersion: 1,
      pluginId: 'com.deepchat.plugins.cua',
      runtimeId: 'cua-driver',
      runtimeVersion: '0.14.1',
      target: 'win32/arm64',
      runtimeRoot: 'runtime/win32/arm64',
      binaryPath: 'cua-driver.exe',
      catalogPath: 'tool-catalog.json',
      executablePaths: ['cua-driver.exe']
    })
    expect(integrity.files['cua-driver.exe']).toMatch(/^[a-f0-9]{64}$/)
    expect(integrity.files['tool-catalog.json']).toMatch(/^[a-f0-9]{64}$/)
  })

  it('scopes reviewed platform-specific tool policies to each target catalog', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')
    const manifestPath = path.join(fixture.pluginDir, 'plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    Object.assign(manifest.toolPolicies[0].tools, {
      debug_window_info: 'deny',
      mouse_button_down: 'deny',
      mouse_button_up: 'deny',
      mouse_drag: 'deny',
      parallel_mouse_drag: 'ask'
    })
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const createTool = (name: string, destructive: boolean) => ({
      name,
      description: `${name} fixture.`,
      input_schema: { type: 'object', properties: {}, required: [] },
      read_only: !destructive,
      destructive,
      idempotent: true
    })
    const linuxCatalogPath = path.join(
      fixture.pluginDir,
      'runtime',
      'linux',
      'x64',
      'tool-catalog.json'
    )
    const linuxCatalog = JSON.parse(await readFile(linuxCatalogPath, 'utf8'))
    linuxCatalog.tools.push(
      createTool('mouse_button_down', true),
      createTool('mouse_button_up', true),
      createTool('mouse_drag', true),
      createTool('parallel_mouse_drag', true)
    )
    await writeFile(linuxCatalogPath, `${JSON.stringify(linuxCatalog, null, 2)}\n`)

    const windowsCatalogPath = path.join(
      fixture.pluginDir,
      'runtime',
      'win32',
      'x64',
      'tool-catalog.json'
    )
    const windowsCatalog = JSON.parse(await readFile(windowsCatalogPath, 'utf8'))
    windowsCatalog.tools.push(createTool('debug_window_info', false))
    await writeFile(windowsCatalogPath, `${JSON.stringify(windowsCatalog, null, 2)}\n`)

    for (const [platform, expectedPolicy] of [
      [
        'linux',
        {
          check_permissions: 'allow',
          mouse_button_down: 'deny',
          mouse_button_up: 'deny',
          mouse_drag: 'deny',
          parallel_mouse_drag: 'ask'
        }
      ],
      ['darwin', { check_permissions: 'allow' }],
      ['win32', { check_permissions: 'allow', debug_window_info: 'deny' }]
    ] as const) {
      const result = runPackagePlugin(fixture.pluginDir, outDir, platform, 'x64')
      if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout)
      }
      const artifactPath = path.join(
        outDir,
        `deepchat-plugin-cua-0.0.0-${platform}-x64.dcplugin`
      )
      const files = unzipSync(new Uint8Array(await readFile(artifactPath)))
      const packagedManifest = JSON.parse(Buffer.from(files['plugin.json']).toString('utf8'))
      const packagedPolicy = packagedManifest.toolPolicies[0].tools
      const packagedPolicyFile = JSON.parse(
        Buffer.from(files['policies/tool-policy.json']).toString('utf8')
      )

      expect(packagedPolicy).toEqual(expectedPolicy)
      expect(packagedPolicyFile).toEqual(packagedManifest.toolPolicies[0])
    }
  })

  it('rejects unrecognized platform-specific policy entries', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')
    const manifestPath = path.join(fixture.pluginDir, 'plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.toolPolicies[0].tools.unknown_platform_tool = 'ask'
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'darwin', 'arm64')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'CUA tool policy/catalog mismatch (missing: none; extra: unknown_platform_tool)'
    )
  })

  it('rejects Windows CUA packages that include the unsigned UIA worker', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')
    const uiaPath = path.join(
      fixture.pluginDir,
      'runtime',
      'win32',
      'x64',
      'cua-driver-uia.exe'
    )
    await writeFile(uiaPath, 'uia')

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'win32', 'x64')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'CUA Windows runtime win32/x64 must not bundle cua-driver-uia.exe'
    )
  })

  it('replaces a stale descriptor without creating a self-referential file set', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')
    await writeFile(
      path.join(fixture.pluginDir, 'runtime', 'win32', 'x64', 'integrity.json'),
      '{"stale":true}\n'
    )

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'win32', 'x64')

    expect(result.status).toBe(0)
    const artifactPath = path.join(outDir, 'deepchat-plugin-cua-0.0.0-win32-x64.dcplugin')
    const files = unzipSync(new Uint8Array(await readFile(artifactPath)))
    const integrity = JSON.parse(
      Buffer.from(files['runtime/win32/x64/integrity.json']).toString('utf8')
    )
    expect(integrity.files).not.toHaveProperty('integrity.json')
  })

  it('records the explicit macOS distribution identity in the integrity descriptor', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'darwin', 'arm64', {
      purpose: 'distribution',
      env: { DEEPCHAT_APPLE_NOTARY_TEAM_ID: 'Y7P5QLKLYG' }
    })

    expect(result.status).toBe(0)
    const artifactPath = path.join(outDir, 'deepchat-plugin-cua-0.0.0-darwin-arm64.dcplugin')
    const files = unzipSync(new Uint8Array(await readFile(artifactPath)))
    const integrity = JSON.parse(
      Buffer.from(files['runtime/darwin/arm64/integrity.json']).toString('utf8')
    )
    expect(integrity.macos).toMatchObject({
      signatureType: 'developer-id',
      teamId: 'Y7P5QLKLYG',
      hardenedRuntime: true
    })
    expect(() =>
      parseCuaRuntimeIntegrityDescriptor(integrity, 'packaged distribution fixture')
    ).not.toThrow()
  })

  it('rejects macOS distribution packaging without a valid Apple Team ID', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')

    for (const teamId of ['', 'invalid-team']) {
      const result = runPackagePlugin(fixture.pluginDir, outDir, 'darwin', 'arm64', {
        purpose: 'distribution',
        env: { DEEPCHAT_APPLE_NOTARY_TEAM_ID: teamId }
      })

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(
        'CUA macOS distribution integrity descriptor requires a valid Apple Team ID'
      )
    }
  })

  it('packages the DeepChat-owned macOS CUA helper identity for each macOS arch', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')

    for (const arch of ['x64', 'arm64']) {
      const result = runPackagePlugin(fixture.pluginDir, outDir, 'darwin', arch)

      if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout)
      }
      const artifactPath = path.join(outDir, `deepchat-plugin-cua-0.0.0-darwin-${arch}.dcplugin`)
      const files = unzipSync(new Uint8Array(await readFile(artifactPath)))
      const manifest = JSON.parse(Buffer.from(files['plugin.json']).toString('utf8'))
      const runtimeFiles = Object.keys(files).filter((file) => file.startsWith('runtime/')).sort()

      expect(manifest.engines.targets).toEqual([`darwin/${arch}`])
      expect(manifest.runtime.detect).toEqual([
        'app-helper:DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver',
        `plugin:runtime/darwin/${arch}/DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver`,
        `plugin:runtime/win32/${arch}/cua-driver.exe`,
        `plugin:runtime/linux/${arch}/cua-driver`
      ])
      expect(runtimeFiles).toEqual([
        `runtime/darwin/${arch}/DeepChat Computer Use.app/Contents/Info.plist`,
        `runtime/darwin/${arch}/DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver`,
        `runtime/darwin/${arch}/integrity.json`,
        `runtime/darwin/${arch}/tool-catalog.json`
      ])
      expect(Buffer.from(files[runtimeFiles[0]]).toString('utf8')).toContain(
        '<string>com.deepchat.computeruse.helper</string>'
      )
    }
  })

  it('packages the Linux CUA runtime without changing its binary name', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'linux', 'x64')

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout)
    }
    const artifactPath = path.join(outDir, 'deepchat-plugin-cua-0.0.0-linux-x64.dcplugin')
    const files = unzipSync(new Uint8Array(await readFile(artifactPath)))

    expect(Object.keys(files).filter((file) => file.startsWith('runtime/')).sort()).toEqual([
      'runtime/linux/x64/cua-driver',
      'runtime/linux/x64/integrity.json',
      'runtime/linux/x64/tool-catalog.json'
    ])
  })

  it('rejects unsupported CUA targets before scoped package metadata can make them visible', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'linux', 'arm64')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Plugin com.deepchat.plugins.cua does not support linux/arm64')
  })

  it('rejects CUA manifests that omit embedded proxy mode', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')
    const manifestPath = path.join(fixture.pluginDir, 'plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.mcpServers[0].args = ['mcp']
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'win32', 'x64')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('CUA MCP server args must be ["mcp","--embedded"]')
  })

  it('accepts the exact embedded adapter contract regardless of JSON key order', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')
    const manifestPath = path.join(fixture.pluginDir, 'plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.runtime.adapterContract = Object.fromEntries(
      Object.entries(manifest.runtime.adapterContract).reverse()
    )
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'win32', 'x64')

    expect(result.status).toBe(0)
  })

  it('rejects CUA manifests that declare environment overrides', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')
    const manifestPath = path.join(fixture.pluginDir, 'plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.mcpServers[0].env = {
      CUA_DRIVER_RS_SPAWN_UIA_WORKER: '0'
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'win32', 'x64')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('CUA MCP server must not declare environment overrides')
  })

  it('rejects a static catalog that is not covered by explicit tool policy', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')
    const catalogPath = path.join(
      fixture.pluginDir,
      'runtime',
      'linux',
      'x64',
      'tool-catalog.json'
    )
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
    catalog.tools.push({
      name: 'click',
      description: 'Click.',
      input_schema: { type: 'object', properties: {} },
      read_only: false,
      destructive: true,
      idempotent: false
    })
    await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'linux', 'x64')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('CUA tool policy/catalog mismatch (missing: click; extra: none)')
  })

  it('rejects macOS CUA manifests that still reference upstream helper paths', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')
    const manifestPath = path.join(fixture.pluginDir, 'plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.runtime.detect = [
      'plugin:runtime/darwin/${arch}/CuaDriver.app/Contents/MacOS/cua-driver',
      'plugin:runtime/win32/${arch}/cua-driver.exe',
      'plugin:runtime/linux/${arch}/cua-driver',
      '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'
    ]
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'darwin', 'x64')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'CUA macOS runtime detect path must prefer app-helper:DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver'
    )
  })

  it('rejects macOS CUA helpers that keep the upstream bundle identifier', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')
    const infoPlistPath = path.join(
      fixture.pluginDir,
      'runtime',
      'darwin',
      'x64',
      DARWIN_HELPER_APP,
      'Contents',
      'Info.plist'
    )
    await writeFile(infoPlistPath, darwinInfoPlist({ bundleId: 'com.trycua.driver' }))

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'darwin', 'x64')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'CUA macOS helper CFBundleIdentifier must be com.deepchat.computeruse.helper'
    )
  })

  it('rejects macOS CUA helpers that keep legacy root CodeResources signatures', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')
    const codeResourcesPath = path.join(
      fixture.pluginDir,
      'runtime',
      'darwin',
      'x64',
      DARWIN_HELPER_APP,
      'Contents',
      'CodeResources'
    )
    await writeFile(codeResourcesPath, 'legacy signature')

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'darwin', 'x64')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      'CUA macOS runtime must not stage legacy signature file runtime/darwin/x64/DeepChat Computer Use.app/Contents/CodeResources'
    )
  })
})
