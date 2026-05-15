import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const args = { action: null, name: null, platform: null, arch: null }
  args.action = argv[0]
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--name') {
      args.name = argv[++i]
    } else if (argv[i] === '--platform') {
      args.platform = argv[++i]
    } else if (argv[i] === '--arch') {
      args.arch = argv[++i]
    }
  }
  if (!args.action || !['validate', 'package', 'bundle'].includes(args.action)) {
    console.error('Usage: node scripts/plugin.mjs <validate|package|bundle> --name <plugin> [--platform <p>] [--arch <a>]')
    process.exit(1)
  }
  if (!args.name) {
    console.error('Missing required --name <plugin> argument')
    process.exit(1)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const pluginDir = path.resolve('plugins', args.name)

if (!existsSync(path.join(pluginDir, 'plugin.json'))) {
  console.error(`Plugin not found: ${pluginDir}/plugin.json`)
  process.exit(1)
}

// Run native build step if the plugin has one (e.g. scripts/build-cua-plugin-runtime.mjs)
const nativeBuildScript = path.resolve(`scripts/build-${args.name}-plugin-runtime.mjs`)
if (args.action === 'bundle' && existsSync(nativeBuildScript)) {
  const buildArgs = [nativeBuildScript]
  if (args.arch) buildArgs.push('--arch', args.arch)
  execFileSync('node', buildArgs, { stdio: 'inherit' })
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
