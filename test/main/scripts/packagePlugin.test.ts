import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'

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
        args: ['mcp', '--no-daemon-relaunch'],
        env: {
          CUA_DRIVER_MCP_MODE: '1',
          CUA_DRIVER_RS_MCP_NO_RELAUNCH: '1',
          DEEPCHAT_COMPUTER_USE_APP_PATH: '${runtime.cua-driver.helperAppPath}',
          DEEPCHAT_COMPUTER_USE_BINARY_PATH: '${runtime.cua-driver.command}'
        },
        autoApprove: []
      }
    ]
  }

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
    await chmod(darwinExecutable, 0o755)

    const runtimeDir = path.join(pluginDir, 'runtime', 'win32', arch)
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(path.join(runtimeDir, 'cua-driver.exe'), 'driver')
    await writeFile(path.join(runtimeDir, 'cua-driver-uia.exe'), 'uia')
  }
  const linuxRuntimeDir = path.join(pluginDir, 'runtime', 'linux', 'x64')
  const linuxExecutable = path.join(linuxRuntimeDir, 'cua-driver')
  await mkdir(linuxRuntimeDir, { recursive: true })
  await writeFile(linuxExecutable, 'driver')
  await chmod(linuxExecutable, 0o755)

  return { root, pluginDir }
}

function runPackagePlugin(pluginDir: string, outDir: string, platform: string, arch: string) {
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
      pluginDir
    ],
    {
      cwd: ROOT,
      encoding: 'utf8'
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
    expect(manifest.mcpServers[0].args).toEqual(['mcp', '--no-daemon-relaunch'])
    expect(manifest.mcpServers[0].env.CUA_DRIVER_RS_MCP_NO_RELAUNCH).toBe('1')
    expect(Object.keys(files).filter((file) => file.startsWith('runtime/')).sort()).toEqual([
      'runtime/win32/arm64/cua-driver-uia.exe',
      'runtime/win32/arm64/cua-driver.exe'
    ])
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
        `runtime/darwin/${arch}/DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver`
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
      'runtime/linux/x64/cua-driver'
    ])
  })

  it('rejects unsupported CUA targets before scoped package metadata can make them visible', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'linux', 'arm64')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Plugin com.deepchat.plugins.cua does not support linux/arm64')
  })

  it('rejects CUA manifests that allow daemon relaunch from MCP mode', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')
    const manifestPath = path.join(fixture.pluginDir, 'plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.mcpServers[0].args = ['mcp']
    delete manifest.mcpServers[0].env.CUA_DRIVER_RS_MCP_NO_RELAUNCH
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'win32', 'x64')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('CUA MCP server args must be ["mcp","--no-daemon-relaunch"]')
  })

  it('rejects CUA manifests that omit the no-relaunch environment guard', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')
    const manifestPath = path.join(fixture.pluginDir, 'plugin.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.mcpServers[0].env.CUA_DRIVER_RS_MCP_NO_RELAUNCH
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'win32', 'x64')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('CUA MCP server env CUA_DRIVER_RS_MCP_NO_RELAUNCH must be 1')
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
