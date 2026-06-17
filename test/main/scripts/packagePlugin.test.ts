import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const tempRoots: string[] = []

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
        'plugin:runtime/darwin/${arch}/CuaDriver.app/Contents/MacOS/cua-driver',
        'plugin:runtime/win32/${arch}/cua-driver.exe',
        'plugin:runtime/linux/${arch}/cua-driver',
        '/Applications/CuaDriver.app/Contents/MacOS/cua-driver'
      ]
    },
    mcpServers: [
      {
        id: 'cua-driver',
        displayName: 'CUA Driver',
        transport: 'stdio',
        command: '${runtime.cua-driver.command}',
        args: [],
        env: {
          CUA_DRIVER_MCP_MODE: '1',
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
    const runtimeDir = path.join(pluginDir, 'runtime', 'win32', arch)
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(path.join(runtimeDir, 'cua-driver.exe'), 'driver')
    await writeFile(path.join(runtimeDir, 'cua-driver-uia.exe'), 'uia')
  }

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
    expect(Object.keys(files).filter((file) => file.startsWith('runtime/')).sort()).toEqual([
      'runtime/win32/arm64/cua-driver-uia.exe',
      'runtime/win32/arm64/cua-driver.exe'
    ])
  })

  it('rejects unsupported CUA targets before scoped package metadata can make them visible', async () => {
    const fixture = await createCuaPluginFixture()
    const outDir = path.join(fixture.root, 'out')

    const result = runPackagePlugin(fixture.pluginDir, outDir, 'linux', 'arm64')

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Plugin com.deepchat.plugins.cua does not support linux/arm64')
  })
})
