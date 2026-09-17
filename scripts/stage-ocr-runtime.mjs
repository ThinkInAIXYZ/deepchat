// Stages the packaged OCR runtime layout into a directory without running
// electron-builder, so DEEPCHAT_UNBUNDLE_OCR=1 builds can still produce the
// remote-distribution payload via plugin:catalog generate.
//
// Usage:
//   node scripts/stage-ocr-runtime.mjs --platform <darwin|win32|linux>
//     --arch <arm64|x64> --out <dir>
//
// Requires the same inputs the bundled layout needs: the light-ocr packages
// (pnpm install), the repository runtime/node binary (installRuntime:<platform>:<arch>),
// and the built out/main helper (pnpm run build). The staged unpacked root is
// printed and feeds plugin:catalog generate --runtime-dir <root>/runtime.
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { packageLightOcrAssets } from './afterPack.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDir, '..')

function parseArgs(argv) {
  const args = { platform: process.platform, arch: process.arch, out: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--platform') {
      args.platform = argv[++index]
    } else if (argument === '--arch') {
      args.arch = argv[++index]
    } else if (argument === '--out') {
      args.out = argv[++index]
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Missing or empty value for --${key}`)
    }
  }
  if (!args.out) throw new Error('--out is required')
  return args
}

function resolveResourcesDir(platform, appOutDir) {
  // Mirrors getResourcesDir in afterPack.js for a synthetic context.
  if (platform === 'darwin') {
    return path.join(appOutDir, 'DeepChat.app', 'Contents', 'Resources')
  }
  return path.join(appOutDir, 'resources')
}

async function main() {
  const { platform, arch, out } = parseArgs(process.argv.slice(2))
  const appOutDir = path.resolve(out)
  rmSync(appOutDir, { recursive: true, force: true })
  const resourcesDir = resolveResourcesDir(platform, appOutDir)
  const unpackedRoot = path.join(resourcesDir, 'app.asar.unpacked')

  // The bundled app receives runtime/node through electron-builder
  // extraResources; stage it directly from the repository runtime directory
  // so the manifest pins the Node binary path and its checksum.
  const repoNodeDir = path.join(repositoryRoot, 'runtime', 'node')
  if (!existsSync(repoNodeDir)) {
    throw new Error(
      `Repository Node runtime is missing: ${repoNodeDir} (run installRuntime for this platform first)`
    )
  }
  cpSync(repoNodeDir, path.join(unpackedRoot, 'runtime', 'node'), {
    recursive: true,
    dereference: true
  })

  await packageLightOcrAssets({
    packager: { projectDir: repositoryRoot, appInfo: { productFilename: 'DeepChat' } },
    electronPlatformName: platform,
    arch,
    appOutDir
  })

  const manifestPath = path.join(unpackedRoot, 'runtime', 'ocr', 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.supported !== true || !manifest.paths?.node) {
    throw new Error(
      `Staged OCR runtime manifest is not an installable payload: ${manifestPath}`
    )
  }
  console.log(`[stage-ocr-runtime] staged installable OCR runtime layout at ${unpackedRoot}`)
}

await main()
