// Plugin distribution catalog tooling.
//
//   generate — scan built artifacts (.dcplugin packages + the OCR runtime
//              payload), pin their sha256/size, and merge entries into
//              resources/plugin-catalog.json.
//   verify   — fetch every catalog artifact (canonical URL first, then each
//              mirror) and verify the pinned sha256/size. Release gate for
//              "the published assets match the catalog" (spec §4.4 L3).
//
// Usage:
//   node scripts/plugin-catalog.mjs generate [--artifacts-dir <dir>]
//     [--base-url <url>] [--mirror <url>]... [--channel stable|pre-release]
//     [--min-app-version <version>] [--runtime-dir <dir>] [--write]
//   node scripts/plugin-catalog.mjs verify [--catalog <path>]
//     [--platform <p>] [--arch <a>] [--timeout-ms <n>]
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync, unzipSync } from 'fflate'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDir, '..')
const CATALOG_PATH = path.join(repositoryRoot, 'resources', 'plugin-catalog.json')
const CATALOG_SCHEMA_VERSION = 1
const OCR_RUNTIME_ASSET_ID = 'light-ocr'
const PLUGIN_PACKAGE_SUFFIX = '.dcplugin'
const SHA256_PATTERN = /^[a-f0-9]{64}$/

const appVersion = JSON.parse(
  readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
).version

function parseArgs(argv) {
  const args = {
    action: argv[0],
    baseUrl: null,
    mirrors: [],
    channel: 'stable',
    minAppVersion: appVersion,
    artifactsDir: path.join(repositoryRoot, 'build', 'bundled-plugins'),
    runtimeDir: path.join(repositoryRoot, 'runtime'),
    appRoot: repositoryRoot,
    catalogPath: CATALOG_PATH,
    platform: process.env.TARGET_PLATFORM || process.platform,
    arch: process.env.TARGET_ARCH || process.arch,
    write: false,
    timeoutMs: 60_000
  }
  if (!args.action || !['generate', 'verify'].includes(args.action)) {
    console.error(
      'Usage: node scripts/plugin-catalog.mjs <generate|verify> [options] — see header comment'
    )
    process.exit(1)
  }
  for (let i = 1; i < argv.length; i += 1) {
    const argument = argv[i]
    if (argument === '--base-url') {
      args.baseUrl = argv[++i]
    } else if (argument === '--mirror') {
      const mirror = argv[++i]
      if (!mirror) {
        console.error('Missing value for --mirror')
        process.exit(1)
      }
      args.mirrors.push(mirror)
    } else if (argument === '--channel') {
      args.channel = argv[++i]
    } else if (argument === '--min-app-version') {
      args.minAppVersion = argv[++i]
    } else if (argument === '--artifacts-dir') {
      args.artifactsDir = path.resolve(argv[++i])
    } else if (argument === '--runtime-dir') {
      args.runtimeDir = path.resolve(argv[++i])
    } else if (argument === '--app-root') {
      args.appRoot = path.resolve(argv[++i])
    } else if (argument === '--catalog') {
      args.catalogPath = path.resolve(argv[++i])
    } else if (argument === '--platform') {
      args.platform = String(argv[++i]).toLowerCase()
    } else if (argument === '--arch') {
      args.arch = String(argv[++i]).toLowerCase()
    } else if (argument === '--write') {
      args.write = true
    } else if (argument === '--timeout-ms') {
      args.timeoutMs = Number(argv[++i])
    } else {
      console.error(`Unknown argument: ${argument}`)
      process.exit(1)
    }
  }
  if (args.action === 'generate' && !args.baseUrl) {
    console.error('generate requires --base-url <url> (the release download root)')
    process.exit(1)
  }
  if (!['stable', 'pre-release'].includes(args.channel)) {
    console.error('--channel must be stable or pre-release')
    process.exit(1)
  }
  return args
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function assertHttpUrl(value, label) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('not http(s)')
    }
  } catch {
    throw new Error(`${label} must be an http(s) URL: ${value}`)
  }
}

function readCatalog(catalogPath) {
  if (!existsSync(catalogPath)) {
    throw new Error(`Catalog not found: ${catalogPath}`)
  }
  const catalog = readJson(catalogPath)
  if (catalog.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    throw new Error(`Unsupported catalog schemaVersion: ${catalog.schemaVersion}`)
  }
  return catalog
}

function buildTargetEntry(options, url, filePath) {
  const size = statSync(filePath).size
  const sha256 = sha256File(filePath)
  return { url, sha256, size, mirrors: [...options.mirrors] }
}

function platformArchFromArtifactName(fileName, suffix) {
  const match = new RegExp(`-(darwin|win32|linux)-(arm64|x64)\\${suffix}$`).exec(fileName)
  return match ? { platform: match[1], arch: match[2] } : null
}

function generate(args) {
  assertHttpUrl(args.baseUrl, '--base-url')
  for (const mirror of args.mirrors) {
    assertHttpUrl(mirror, '--mirror')
  }
  if (!existsSync(args.artifactsDir)) {
    throw new Error(`Artifacts directory not found: ${args.artifactsDir}`)
  }

  const artifacts = []
  const packagesByName = new Map()
  for (const entry of readdirSync(args.artifactsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(PLUGIN_PACKAGE_SUFFIX)) continue
    const filePath = path.join(args.artifactsDir, entry.name)
    const target = platformArchFromArtifactName(entry.name, PLUGIN_PACKAGE_SUFFIX)
    if (!target) {
      throw new Error(
        `Cannot derive platform/arch from artifact name: ${entry.name} (expected -<platform>-<arch>.dcplugin)`
      )
    }
    const files = unzipSync(new Uint8Array(readFileSync(filePath)))
    const manifestFile = files['plugin.json']
    if (!manifestFile) {
      throw new Error(`Plugin package is missing plugin.json: ${entry.name}`)
    }
    const manifest = JSON.parse(Buffer.from(manifestFile).toString('utf8'))
    if (!manifest.id || !manifest.version) {
      throw new Error(`Plugin package manifest is incomplete: ${entry.name}`)
    }
    const url = `${args.baseUrl.replace(/\/$/, '')}/${entry.name}`
    const targetEntry = buildTargetEntry(args, url, filePath)
    const existing = packagesByName.get(manifest.id)
    if (existing) {
      existing.targets.push(targetEntry)
    } else {
      packagesByName.set(manifest.id, {
        pluginId: manifest.id,
        version: manifest.version,
        channel: args.channel,
        displayName: manifest.name,
        minAppVersion: args.minAppVersion,
        targets: [targetEntry]
      })
    }
  }
  artifacts.push(...packagesByName.values())

  const runtimeAssets = []
  const ocrRuntimeDir = path.join(args.runtimeDir, 'ocr')
  const ocrManifestPath = path.join(ocrRuntimeDir, 'manifest.json')
  if (existsSync(ocrManifestPath)) {
    const manifest = readJson(ocrManifestPath)
    const helperPath = manifest.paths?.helper
    if (!helperPath) {
      throw new Error('OCR runtime manifest does not declare a helper path')
    }
    // The payload mirrors the unpacked app root layout: runtime/ocr/** plus
    // the built helper entry. Only the OCR subtree is packaged — the node/uv
    // toolchain runtimes are distributed separately.
    const payloadFiles = {}
    collectFiles(ocrRuntimeDir, ocrRuntimeDir, payloadFiles, 'runtime/ocr')
    const helperAbs = path.join(args.appRoot, helperPath)
    if (!existsSync(helperAbs)) {
      throw new Error(`OCR helper entry not found: ${helperAbs}`)
    }
    payloadFiles[helperPath] = new Uint8Array(readFileSync(helperAbs))
    const payload = zipSync(payloadFiles, { level: 6 })
    const fileName = `${OCR_RUNTIME_ASSET_ID}-${manifest.bundleId}-${manifest.platform}-${manifest.arch}.zip`
    const url = `${args.baseUrl.replace(/\/$/, '')}/${fileName}`
    const targetEntry = {
      url,
      sha256: createHash('sha256').update(payload).digest('hex'),
      size: payload.length,
      mirrors: [...args.mirrors]
    }
    runtimeAssets.push({
      id: OCR_RUNTIME_ASSET_ID,
      version: manifest.bundleId,
      channel: args.channel,
      displayName: 'LightOCR Runtime',
      minAppVersion: args.minAppVersion,
      targets: [targetEntry]
    })
    if (args.write) {
      const outDir = args.artifactsDir
      mkdirSync(outDir, { recursive: true })
      writeFileSync(path.join(outDir, fileName), Buffer.from(payload))
      console.log(`Packaged ${path.relative(repositoryRoot, path.join(outDir, fileName))}`)
    }
  }

  const catalog = existsSync(args.catalogPath)
    ? readCatalog(args.catalogPath)
    : { schemaVersion: CATALOG_SCHEMA_VERSION, artifacts: [] }
  // Regeneration replaces entries with the same ids and keeps the rest.
  const regeneratedPluginIds = new Set(artifacts.map((entry) => entry.pluginId))
  const mergedArtifacts = [
    ...artifacts,
    ...(catalog.artifacts ?? []).filter((entry) => !regeneratedPluginIds.has(entry.pluginId))
  ]
  const regeneratedAssetIds = new Set(runtimeAssets.map((entry) => entry.id))
  const mergedRuntimeAssets = [
    ...runtimeAssets,
    ...(catalog.runtimeAssets ?? []).filter((entry) => !regeneratedAssetIds.has(entry.id))
  ]
  const nextCatalog = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    artifacts: mergedArtifacts,
    runtimeAssets: mergedRuntimeAssets
  }
  validateCatalogShape(nextCatalog)

  if (args.write) {
    writeFileSync(args.catalogPath, `${JSON.stringify(nextCatalog, null, 2)}\n`)
    console.log(`Updated ${path.relative(repositoryRoot, args.catalogPath)}`)
  } else {
    console.log(JSON.stringify(nextCatalog, null, 2))
  }
}

function collectFiles(rootDir, currentDir, into, prefix = '') {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const absolute = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(rootDir, absolute, into, prefix)
      continue
    }
    if (!entry.isFile()) continue
    const relative = path.relative(rootDir, absolute).split(path.sep).join('/')
    into[`${prefix}${prefix ? '/' : ''}${relative}`] = new Uint8Array(readFileSync(absolute))
  }
}

function validateCatalogShape(catalog) {
  for (const artifact of catalog.artifacts ?? []) {
    if (!artifact.pluginId || !artifact.version || !Array.isArray(artifact.targets)) {
      throw new Error(`Catalog artifact entry is incomplete: ${JSON.stringify(artifact).slice(0, 120)}`)
    }
    validateTargets(artifact.targets, `plugin ${artifact.pluginId}`)
  }
  for (const asset of catalog.runtimeAssets ?? []) {
    if (!asset.id || !asset.version || !Array.isArray(asset.targets)) {
      throw new Error(`Catalog runtime asset entry is incomplete: ${JSON.stringify(asset).slice(0, 120)}`)
    }
    validateTargets(asset.targets, `runtime asset ${asset.id}`)
  }
}

function validateTargets(targets, label) {
  if (targets.length === 0) {
    throw new Error(`Catalog ${label} has no targets`)
  }
  for (const target of targets) {
    if (!SHA256_PATTERN.test(target.sha256 ?? '')) {
      throw new Error(`Catalog ${label} has an invalid sha256 pin`)
    }
    if (!Number.isInteger(target.size) || target.size <= 0) {
      throw new Error(`Catalog ${label} has an invalid size`)
    }
    assertHttpUrl(target.url, `Catalog ${label} url`)
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal })
    return response
  } finally {
    clearTimeout(timer)
  }
}

async function verifyTarget(url, expected, timeoutMs) {
  const response = await fetchWithTimeout(url, timeoutMs)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length !== expected.size) {
    throw new Error(`size mismatch: expected ${expected.size}, got ${bytes.length}`)
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== expected.sha256) {
    throw new Error(`sha256 mismatch: expected ${expected.sha256}, got ${sha256}`)
  }
}

async function verify(args) {
  const catalog = readCatalog(args.catalogPath)
  validateCatalogShape(catalog)
  const targets = []
  for (const artifact of catalog.artifacts ?? []) {
    for (const target of artifact.targets) {
      if (
        (args.platform === 'all' || target.platform === args.platform) &&
        (args.arch === 'all' || target.arch === args.arch)
      ) {
        targets.push({ label: `plugin ${artifact.pluginId}`, target })
      }
    }
  }
  for (const asset of catalog.runtimeAssets ?? []) {
    for (const target of asset.targets) {
      if (
        (args.platform === 'all' || target.platform === args.platform) &&
        (args.arch === 'all' || target.arch === args.arch)
      ) {
        targets.push({ label: `runtime asset ${asset.id}`, target })
      }
    }
  }
  if (targets.length === 0) {
    throw new Error('No catalog targets match the verification filters')
  }

  let failures = 0
  for (const { label, target } of targets) {
    const candidates = [target.url, ...(target.mirrors ?? []).map((mirror) => `${mirror}${target.url}`)]
    let verified = false
    for (const url of candidates) {
      try {
        await verifyTarget(url, target, args.timeoutMs)
        console.log(`ok ${label} ${url}`)
        verified = true
        break
      } catch (error) {
        console.warn(`fail ${label} ${url}: ${error.message}`)
      }
    }
    if (!verified) {
      // Try the canonical URL once more without mirrors to surface its error.
      failures += 1
    }
  }
  if (failures > 0) {
    throw new Error(`${failures} catalog target(s) failed verification`)
  }
  console.log(`verified ${targets.length} catalog target(s)`)
}

const args = parseArgs(process.argv.slice(2))
try {
  if (args.action === 'generate') {
    generate(args)
  } else {
    await verify(args)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
