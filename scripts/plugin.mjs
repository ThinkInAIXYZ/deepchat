import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

const OFFICIAL_PLUGIN_SOURCE = 'deepchat-official'
const CUA_MANAGED_HELPER_APP = 'DeepChat Computer Use.app'
const CUA_MANAGED_HELPER_EXECUTABLE = 'deepchat-cua-driver'

function parseArgs(argv) {
  const args = {
    action: null,
    name: null,
    platform: process.env.TARGET_PLATFORM || process.platform,
    arch: process.env.TARGET_ARCH || process.arch,
    pluginRoot: null
  }
  args.action = argv[0]
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--name') {
      args.name = argv[++i]
    } else if (argv[i] === '--platform') {
      args.platform = argv[++i]
    } else if (argv[i] === '--arch') {
      args.arch = argv[++i]
    } else if (argv[i] === '--plugin-root') {
      args.pluginRoot = path.resolve(argv[++i])
    }
  }
  if (!args.action || !['validate', 'package', 'bundle', 'verify'].includes(args.action)) {
    console.error(
      'Usage: node scripts/plugin.mjs <validate|package|bundle|verify> [--name <plugin>] [--platform <p>] [--arch <a>] [--plugin-root <path>]'
    )
    process.exit(1)
  }
  if (args.action !== 'verify' && !args.name) {
    console.error('Missing required --name <plugin> argument')
    process.exit(1)
  }
  if (args.action === 'verify' && !args.pluginRoot) {
    console.error('Missing required --plugin-root <path> argument for verify')
    process.exit(1)
  }
  args.platform = String(args.platform).toLowerCase()
  args.arch = String(args.arch).toLowerCase()
  return args
}

const args = parseArgs(process.argv.slice(2))
const packageVersion = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')).version

function readPluginManifest(pluginName) {
  const pluginDir = path.resolve('plugins', pluginName)
  const manifestPath = path.join(pluginDir, 'plugin.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`Plugin not found: ${manifestPath}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return { pluginDir, manifest }
}

function discoverOfficialPlugins() {
  const pluginsRoot = path.resolve('plugins')
  if (!existsSync(pluginsRoot)) {
    return []
  }

  return readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        const { manifest } = readPluginManifest(entry.name)
        if (manifest.source?.type !== OFFICIAL_PLUGIN_SOURCE) {
          return null
        }
        return {
          name: entry.name,
          manifest,
          platforms: manifest.engines?.platforms ?? [],
          targets: manifest.engines?.targets ?? []
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function isPluginSupported(plugin, targetPlatform, targetArch) {
  const normalizedPlatform = String(targetPlatform).toLowerCase()
  const normalizedArch = String(targetArch).toLowerCase()
  const platforms = new Set(plugin.platforms.map((platform) => String(platform).toLowerCase()))
  const aliases =
    normalizedPlatform === 'darwin' ? ['darwin', 'macos', 'mac'] : [normalizedPlatform]
  const targets = plugin.targets.map((target) => String(target).toLowerCase())
  if (targets.length > 0) {
    return aliases.some((platform) => targets.includes(`${platform}/${normalizedArch}`))
  }
  return aliases.some((platform) => platforms.has(platform))
}

function artifactBaseName(pluginId) {
  return pluginId.startsWith('com.deepchat.plugins.')
    ? `deepchat-plugin-${pluginId.slice('com.deepchat.plugins.'.length)}`
    : pluginId
}

function artifactFileName(plugin, targetPlatform, targetArch) {
  const safeId = artifactBaseName(plugin.manifest.id).replace(/[^a-zA-Z0-9._-]/g, '-')
  return `${safeId}-${packageVersion}-${targetPlatform}-${targetArch}.dcplugin`
}

function verifyArtifacts(options) {
  const pluginRoot = path.resolve(options.pluginRoot)
  const officialPlugins = discoverOfficialPlugins()
  const selected = options.name
    ? officialPlugins.filter((plugin) => plugin.name === options.name)
    : officialPlugins

  if (options.name && selected.length === 0) {
    throw new Error(`Official plugin not found: ${options.name}`)
  }

  const expected = selected.filter((plugin) =>
    isPluginSupported(plugin, options.platform, options.arch)
  )
  if (expected.length === 0) {
    throw new Error(`No official plugins are expected for ${options.platform}/${options.arch}`)
  }

  for (const plugin of expected) {
    const fileName = artifactFileName(plugin, options.platform, options.arch)
    const artifactPath = path.join(pluginRoot, fileName)
    if (!existsSync(artifactPath)) {
      throw new Error(`Missing bundled official plugin: ${artifactPath}`)
    }
    console.log(`Verified ${path.relative(process.cwd(), artifactPath)}`)
  }
}

function stageCuaManagedHelper(pluginDir, targetPlatform, targetArch) {
  if (targetPlatform !== 'darwin') {
    return
  }

  const source = path.join(pluginDir, 'runtime', 'darwin', targetArch, CUA_MANAGED_HELPER_APP)
  const executable = path.join(source, 'Contents', 'MacOS', CUA_MANAGED_HELPER_EXECUTABLE)
  if (!existsSync(executable) || !statSync(executable).isFile()) {
    throw new Error(`Missing CUA managed helper executable: ${executable}`)
  }

  const outRoot = path.resolve('build', 'managed-helpers')
  const target = path.join(outRoot, CUA_MANAGED_HELPER_APP)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(outRoot, { recursive: true })
  cpSync(source, target, { recursive: true })
  console.log(`Staged CUA managed helper: ${path.relative(process.cwd(), target)}`)
}

try {
  if (args.action === 'verify') {
    verifyArtifacts(args)
    process.exit(0)
  }

  const { pluginDir } = readPluginManifest(args.name)

  // Run native build step if the plugin has one (e.g. scripts/build-cua-plugin-runtime.mjs)
  const nativeBuildScript = path.resolve(`scripts/build-${args.name}-plugin-runtime.mjs`)
  if (args.action === 'bundle' && existsSync(nativeBuildScript)) {
    const buildArgs = [nativeBuildScript]
    if (args.platform) buildArgs.push('--platform', args.platform)
    if (args.arch) buildArgs.push('--arch', args.arch)
    execFileSync('node', buildArgs, { stdio: 'inherit' })
  }

  if (args.action === 'bundle' && args.name === 'cua') {
    stageCuaManagedHelper(pluginDir, args.platform, args.arch)
  }

  // Delegate to package-plugin.mjs
  const pkgArgs = [path.resolve('scripts/package-plugin.mjs')]
  if (args.action === 'validate') pkgArgs.push('--validate')
  pkgArgs.push('--release-version-from-root')
  if (args.platform) pkgArgs.push('--target-platform', args.platform)
  if (args.arch) pkgArgs.push('--target-arch', args.arch)
  if (args.action === 'bundle') pkgArgs.push('--out', path.resolve('build/bundled-plugins'))
  pkgArgs.push(pluginDir)

  execFileSync('node', pkgArgs, { stdio: 'inherit' })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
