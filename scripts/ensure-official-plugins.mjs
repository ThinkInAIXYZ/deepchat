import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OFFICIAL_PLUGIN_SOURCE = 'deepchat-official'
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = path.join(rootDir, 'plugins')
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
const outDirDefault = path.join(rootDir, 'build', 'bundled-plugins')

const pluginBuildHooks = {
  'com.deepchat.plugins.cua': (targetArch) => {
    const args = ['scripts/build-cua-plugin-runtime.mjs']
    if (targetArch) {
      args.push('--arch', targetArch)
    }
    run(process.execPath, args)
  }
}

function parseArgs(argv) {
  const args = {
    clean: false,
    cleanOnly: false,
    outDir: outDirDefault,
    pluginRoot: null,
    plugins: [],
    targetPlatform: process.env.TARGET_PLATFORM || process.platform,
    targetArch: process.env.TARGET_ARCH || process.arch,
    verify: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--clean') {
      args.clean = true
      continue
    }
    if (arg === '--clean-only') {
      args.clean = true
      args.cleanOnly = true
      continue
    }
    if (arg === '--out') {
      args.outDir = path.resolve(rootDir, argv[index + 1] || '')
      index += 1
      continue
    }
    if (arg === '--plugin') {
      args.plugins.push(argv[index + 1] || '')
      index += 1
      continue
    }
    if (arg === '--plugin-root') {
      args.pluginRoot = path.resolve(rootDir, argv[index + 1] || '')
      index += 1
      continue
    }
    if (arg === '--target-platform') {
      args.targetPlatform = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg === '--target-arch') {
      args.targetArch = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg === '--verify') {
      args.verify = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!args.targetPlatform || !args.targetArch) {
    throw new Error('Both target platform and target arch are required')
  }
  if (args.verify && !args.pluginRoot) {
    throw new Error('--verify requires --plugin-root')
  }

  return args
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
    shell: false
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
  }
}

function readManifest(pluginRoot) {
  const manifestPath = path.join(pluginRoot, 'plugin.json')
  if (!fs.existsSync(manifestPath)) {
    return null
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

function discoverOfficialPlugins() {
  if (!fs.existsSync(pluginsDir)) {
    return []
  }

  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join('plugins', entry.name)
      const root = path.join(rootDir, dir)
      const manifest = readManifest(root)
      if (!manifest || manifest.source?.type !== OFFICIAL_PLUGIN_SOURCE) {
        return null
      }
      return {
        name: entry.name,
        manifest,
        dir,
        platforms: manifest.engines?.platforms ?? []
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name))
}

function artifactBaseName(manifestId) {
  return manifestId.startsWith('com.deepchat.plugins.')
    ? `deepchat-plugin-${manifestId.slice('com.deepchat.plugins.'.length)}`
    : manifestId
}

function artifactFileName(plugin, targetPlatform, targetArch) {
  const safeId = artifactBaseName(plugin.manifest.id).replace(/[^a-zA-Z0-9._-]/g, '-')
  return `${safeId}-${packageJson.version}-${targetPlatform}-${targetArch}.dcplugin`
}

function selectPlugins(args) {
  const officialPlugins = discoverOfficialPlugins()
  const requested = new Set(args.plugins.filter(Boolean))
  const selected = requested.size
    ? officialPlugins.filter((plugin) => requested.has(plugin.name) || requested.has(plugin.manifest.id))
    : officialPlugins

  if (requested.size && selected.length !== requested.size) {
    const known = officialPlugins.map((plugin) => `${plugin.name} (${plugin.manifest.id})`).join(', ')
    throw new Error(`Unknown official plugin requested. Known plugins: ${known}`)
  }

  return selected
}

function isPluginSupported(plugin, targetPlatform) {
  const platforms = new Set(plugin.platforms.map((platform) => String(platform).toLowerCase()))
  const aliases = targetPlatform === 'darwin' ? ['darwin', 'macos', 'mac'] : [targetPlatform]
  return aliases.some((platform) => platforms.has(platform))
}

function getExpectedPlugins(args) {
  return selectPlugins(args).filter((plugin) => isPluginSupported(plugin, args.targetPlatform))
}

function ensurePlugin(plugin, args) {
  if (!isPluginSupported(plugin, args.targetPlatform)) {
    console.log(
      `Skipping ${plugin.name}: ${args.targetPlatform}/${args.targetArch} is not supported`
    )
    return
  }

  const outPath = path.join(args.outDir, artifactFileName(plugin, args.targetPlatform, args.targetArch))
  if (fs.existsSync(outPath)) {
    console.log(`Found ${path.relative(rootDir, outPath)}`)
    return
  }

  console.log(`Packaging missing ${path.relative(rootDir, outPath)}`)
  pluginBuildHooks[plugin.manifest.id]?.(args.targetArch)
  run(process.execPath, [
    'scripts/package-plugin.mjs',
    '--release-version-from-root',
    '--target-platform',
    args.targetPlatform,
    '--target-arch',
    args.targetArch,
    '--out',
    args.outDir,
    plugin.dir
  ])
}

function verifyPlugins(args) {
  const expectedPlugins = getExpectedPlugins(args)
  if (expectedPlugins.length === 0) {
    throw new Error(`No official plugins are expected for ${args.targetPlatform}/${args.targetArch}`)
  }

  for (const plugin of expectedPlugins) {
    const fileName = artifactFileName(plugin, args.targetPlatform, args.targetArch)
    const packagePath = path.join(args.pluginRoot, fileName)
    if (!fs.existsSync(packagePath)) {
      throw new Error(`Missing bundled official plugin: ${packagePath}`)
    }
    console.log(`Verified ${path.relative(rootDir, packagePath)}`)
  }
}

try {
  const args = parseArgs(process.argv.slice(2))
  if (args.verify) {
    verifyPlugins(args)
  } else {
    if (args.clean) {
      fs.rmSync(args.outDir, { recursive: true, force: true })
    }
    if (!args.cleanOnly) {
      fs.mkdirSync(args.outDir, { recursive: true })
      for (const plugin of selectPlugins(args)) {
        ensurePlugin(plugin, args)
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
