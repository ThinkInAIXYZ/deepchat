import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'

const OFFICIAL_PLUGIN_SOURCE = 'deepchat-official'

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function parseArgs(argv) {
  const args = {
    validateOnly: false,
    outDir: path.resolve('dist', 'plugins'),
    pluginDir: null
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--validate') {
      args.validateOnly = true
      continue
    }
    if (arg === '--out') {
      args.outDir = path.resolve(argv[index + 1] || '')
      index += 1
      continue
    }
    if (!args.pluginDir) {
      args.pluginDir = path.resolve(arg)
    }
  }

  if (!args.pluginDir) {
    throw new Error('Usage: node scripts/package-plugin.mjs [--validate] [--out <dir>] <pluginDir>')
  }
  return args
}

function assertSafeRelativePath(relativePath, label) {
  const normalized = relativePath.replace(/\\/g, '/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('..') ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error(`Unsafe ${label}: ${relativePath}`)
  }
  return normalized
}

function assertFile(pluginDir, relativePath, label) {
  const normalized = assertSafeRelativePath(relativePath, label)
  const absolutePath = path.resolve(pluginDir, ...normalized.split('/').filter(Boolean))
  const relativeToRoot = path.relative(pluginDir, absolutePath)
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error(`${label} escapes plugin root: ${relativePath}`)
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Missing ${label}: ${relativePath}`)
  }
  return absolutePath
}

function readManifest(pluginDir) {
  const manifestPath = assertFile(pluginDir, 'plugin.json', 'manifest')
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
}

function validateManifest(pluginDir, manifest) {
  for (const field of ['id', 'name', 'version', 'publisher']) {
    if (typeof manifest[field] !== 'string' || manifest[field].trim().length === 0) {
      throw new Error(`plugin.json field "${field}" is required`)
    }
  }

  if (manifest.source?.type !== OFFICIAL_PLUGIN_SOURCE) {
    throw new Error('Only official-source plugins can be packaged')
  }

  if (manifest.source.publisher !== manifest.publisher) {
    throw new Error('source.publisher must match publisher')
  }

  if (!Array.isArray(manifest.engines?.platforms) || manifest.engines.platforms.length === 0) {
    throw new Error('engines.platforms must declare at least one platform')
  }

  for (const skill of manifest.skills ?? []) {
    assertFile(pluginDir, skill.path, `skill ${skill.id}`)
  }

  for (const contribution of manifest.settingsContributions ?? []) {
    assertFile(pluginDir, contribution.entry, `settings entry ${contribution.id}`)
    assertFile(pluginDir, contribution.preloadTypes, `preload types ${contribution.id}`)
  }
}

function collectFiles(pluginDir, currentDir = pluginDir, files = {}) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name === '.DS_Store') {
      continue
    }

    const absolutePath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(pluginDir, absolutePath, files)
      continue
    }

    const relativePath = path.relative(pluginDir, absolutePath).replace(/\\/g, '/')
    files[relativePath] = new Uint8Array(fs.readFileSync(absolutePath))
  }
  return files
}

function buildChecksums(files) {
  return Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filePath, content]) => [
        filePath,
        createHash('sha256').update(Buffer.from(content)).digest('hex')
      ])
  )
}

function packagePlugin(pluginDir, outDir, manifest) {
  const files = collectFiles(pluginDir)
  files['checksums.json'] = new TextEncoder().encode(
    `${JSON.stringify(buildChecksums(files), null, 2)}\n`
  )

  fs.mkdirSync(outDir, { recursive: true })
  const artifactBaseName = manifest.id.startsWith('com.deepchat.plugins.')
    ? `deepchat-plugin-${manifest.id.slice('com.deepchat.plugins.'.length)}`
    : manifest.id
  const safeId = artifactBaseName.replace(/[^a-zA-Z0-9._-]/g, '-')
  const outPath = path.join(outDir, `${safeId}-${manifest.version}.dcplugin`)
  fs.writeFileSync(outPath, Buffer.from(zipSync(files, { level: 6 })))
  return outPath
}

try {
  const args = parseArgs(process.argv.slice(2))
  const manifest = readManifest(args.pluginDir)
  validateManifest(args.pluginDir, manifest)
  if (args.validateOnly) {
    console.log(`Plugin ${manifest.id}@${manifest.version} is valid`)
  } else {
    const outPath = packagePlugin(args.pluginDir, args.outDir, manifest)
    console.log(`Packaged ${manifest.id}@${manifest.version}: ${outPath}`)
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
