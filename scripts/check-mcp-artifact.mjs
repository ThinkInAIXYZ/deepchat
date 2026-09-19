import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { stageWorkspaceClosure, assertArtifactDependencyClosure } from './package-artifact.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const compiler = createRequire(new URL('../package.json', import.meta.url)).resolve('typescript/bin/tsc')
const root = fileURLToPath(new URL('../', import.meta.url))
const stage = mkdtempSync(join(tmpdir(), 'deepchat-mcp-artifact-'))
const installed = new Set()
let workspaceArtifacts
function stagePackage(directory) {
  directory = realpathSync(directory)
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (installed.has(manifest.name)) return
  installed.add(manifest.name)
  const target = join(stage, 'node_modules', manifest.name)
  mkdirSync(target, { recursive: true })
  if (manifest.name.startsWith('@deepchat/')) {
    cpSync(workspaceArtifacts.get(manifest.name).directory, target, { recursive: true })
  } else {
    cpSync(directory, target, { recursive: true, filter: (source) => !relative(directory, source).split(sep).includes('node_modules') })
  }
  const require = createRequire(join(directory, 'package.json'))
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const dependency = require.resolve.paths(name).map((base) => join(base, name)).find((candidate) => existsSync(join(candidate, 'package.json')))
    if (!dependency) throw new Error(`Missing dependency ${name} from ${manifest.name}`)
    stagePackage(dependency)
  }
}
try {
  workspaceArtifacts = stageWorkspaceClosure(root, '@deepchat/mcp', join(stage, 'artifacts'))
  assertArtifactDependencyClosure(workspaceArtifacts)
  stagePackage(join(root, 'packages/mcp'))
  stagePackage(join(root, 'packages/mcp/node_modules/@types/node'))
  writeFileSync(join(stage, 'package.json'), JSON.stringify({ type: 'module' }))
  writeFileSync(join(stage, 'consumer.ts'), `import { McpClient, ServerManager, type McpClientHost } from '@deepchat/mcp'\nexport const client: typeof McpClient = McpClient\nexport const manager: typeof ServerManager = ServerManager\nexport type Host = McpClientHost\n`)
  cpSync(join(root, 'scripts/mcp-artifact-consumer.mjs'), join(stage, 'consumer.mjs'))
  cpSync(join(root, 'packages/mcp/test/fixture-server.mjs'), join(stage, 'fixture-server.mjs'))
  execFileSync(process.execPath, [compiler, '--noEmit', '--strict', '--types', 'node', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'consumer.ts'], { cwd: stage, stdio: 'inherit' })
  execFileSync(process.execPath, ['consumer.mjs'], { cwd: stage, stdio: 'inherit', env: { ...process.env, NODE_PATH: '' } })
  console.log(`MCP isolated declaration/runtime/transport gate passed (${installed.size} manifest dependencies)`)
} finally {
  rmSync(stage, { recursive: true, force: true })
}
