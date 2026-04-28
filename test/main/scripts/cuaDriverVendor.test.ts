import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const buildScriptPath = path.join(repoRoot, 'scripts', 'build-cua-driver.mjs')
const updateScriptPath = path.join(repoRoot, 'scripts', 'update-cua-driver.mjs')
const electronBuilderConfigPath = path.join(repoRoot, 'electron-builder.yml')
const clickToolPath = path.join(
  repoRoot,
  'vendor',
  'cua-driver',
  'source',
  'Sources',
  'CuaDriverServer',
  'Tools',
  'ClickTool.swift'
)

const packageSwift = `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "cua-driver",
  products: [.executable(name: "cua-driver", targets: ["CuaDriverCLI"])],
  targets: [.executableTarget(name: "CuaDriverCLI")]
)
`

let tempDirs: string[] = []

async function makeTempDir(prefix: string) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(tempDir)
  return tempDir
}

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

async function writeUpstreamSource(repoDir: string, commandContent: string) {
  const sourceDir = path.join(repoDir, 'libs', 'cua-driver')
  const commandDir = path.join(sourceDir, 'Sources', 'CuaDriverCLI')
  await mkdir(commandDir, { recursive: true })
  await writeFile(path.join(sourceDir, 'Package.swift'), packageSwift)
  await writeFile(path.join(commandDir, 'CuaDriverCommand.swift'), commandContent)
}

async function commitUpstreamSource(repoDir: string, message: string) {
  runGit(repoDir, ['add', '.'])
  runGit(repoDir, ['commit', '-m', message])
  return runGit(repoDir, ['rev-parse', 'HEAD'])
}

async function createUpstreamRepo(oldContent: string, newContent: string) {
  const repoDir = await makeTempDir('deepchat-cua-upstream-')
  await mkdir(repoDir, { recursive: true })
  runGit(repoDir, ['init'])
  runGit(repoDir, ['config', 'user.email', 'deepchat@example.invalid'])
  runGit(repoDir, ['config', 'user.name', 'DeepChat CUA Test'])

  await writeUpstreamSource(repoDir, oldContent)
  const oldCommit = await commitUpstreamSource(repoDir, 'old upstream')
  runGit(repoDir, ['tag', 'cua-driver-v1'])

  await writeUpstreamSource(repoDir, newContent)
  const newCommit = await commitUpstreamSource(repoDir, 'new upstream')
  runGit(repoDir, ['tag', 'cua-driver-v2'])

  return { repoDir, oldCommit, newCommit }
}

async function createVendorRoot(
  workspaceRoot: string,
  oldCommit: string,
  upstreamRepo: string,
  commandContent: string
) {
  const vendorRoot = path.join(workspaceRoot, 'vendor', 'cua-driver')
  const sourceDir = path.join(vendorRoot, 'source')
  const commandDir = path.join(sourceDir, 'Sources', 'CuaDriverCLI')
  await mkdir(commandDir, { recursive: true })
  await writeFile(path.join(sourceDir, 'Package.swift'), packageSwift)
  await writeFile(path.join(commandDir, 'CuaDriverCommand.swift'), commandContent)
  await writeFile(
    path.join(vendorRoot, 'upstream.json'),
    `${JSON.stringify(
      {
        upstreamRepo,
        upstreamSubdir: 'libs/cua-driver',
        tag: 'cua-driver-v1',
        commit: oldCommit,
        version: '1',
        updatedAt: '2026-04-28'
      },
      null,
      2
    )}\n`
  )
  return vendorRoot
}

function runUpdateScript(workspaceRoot: string, vendorRoot: string, args: string[]) {
  return spawnSync(process.execPath, [updateScriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEEPCHAT_ROOT_DIR: workspaceRoot,
      DEEPCHAT_CUA_VENDOR_ROOT: vendorRoot
    }
  })
}

describe('CUA Driver vendor scripts', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((tempDir) => rm(tempDir, { recursive: true, force: true })))
    tempDirs = []
  })

  it('builds from vendored source without dynamic upstream patching', async () => {
    const buildScript = await readFile(buildScriptPath, 'utf8')
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'))
    const electronBuilderConfig = await readFile(electronBuilderConfigPath, 'utf8')

    expect(buildScript).toContain("path.join(rootDir, 'vendor', 'cua-driver')")
    expect(buildScript).toContain("'--package-path'")
    expect(buildScript).toContain('VENDOR_SOURCE_DIR')
    expect(buildScript).toContain('DeepChatPermissionProbeCommand')
    expect(buildScript).not.toContain('cloneOrUpdateSource')
    expect(buildScript).not.toContain('CUA_REPO_URL')
    expect(buildScript).not.toContain("run('git'")
    expect(packageJson.scripts['cua:update']).toBe('node scripts/update-cua-driver.mjs')
    expect(packageJson.scripts['cua:diff-upstream']).toBe(
      'node scripts/update-cua-driver.mjs --diff-upstream'
    )
    expect(electronBuilderConfig).toContain("- '!vendor/**'")
  })

  it('keeps element-indexed click arguments resilient to placeholder pixel fields', async () => {
    const clickTool = await readFile(clickToolPath, 'utf8')

    expect(clickTool).toContain('let hasElementIndex = elementIndex != nil')
    expect(clickTool).toContain('let hasXY = !hasElementIndex && x != nil && y != nil')
    expect(clickTool).toContain('let hasPartialXY = !hasElementIndex && (x != nil) != (y != nil)')
    expect(clickTool).toContain('$0.isEmpty ? nil : $0')
    expect(clickTool).not.toContain('Provide either element_index or (x, y), not both.')
  })

  it('reports missing upstream metadata fields clearly', async () => {
    const workspaceRoot = await makeTempDir('deepchat-cua-workspace-')
    const vendorRoot = path.join(workspaceRoot, 'vendor', 'cua-driver')
    await mkdir(vendorRoot, { recursive: true })
    await writeFile(
      path.join(vendorRoot, 'upstream.json'),
      `${JSON.stringify({ upstreamRepo: 'file:///tmp/upstream' }, null, 2)}\n`
    )

    const result = runUpdateScript(workspaceRoot, vendorRoot, ['--tag', 'v2', '--commit', 'abc'])

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain(
      'CUA upstream metadata is missing required string field: upstreamSubdir'
    )
  })

  it('dry-runs an upstream update by applying the DeepChat delta to a new commit', async () => {
    const oldContent = `let upstreamFeature = "base"
let spacer1 = "same"
let spacer2 = "same"
let permissionMode = "upstream"
`
    const newContent = `let upstreamFeature = "added"
let spacer1 = "same"
let spacer2 = "same"
let permissionMode = "upstream"
`
    const localContent = `let upstreamFeature = "base"
let spacer1 = "same"
let spacer2 = "same"
let permissionMode = "deepchat"
`
    const upstream = await createUpstreamRepo(oldContent, newContent)
    const workspaceRoot = await makeTempDir('deepchat-cua-workspace-')
    const vendorRoot = await createVendorRoot(
      workspaceRoot,
      upstream.oldCommit,
      upstream.repoDir,
      localContent
    )

    const result = runUpdateScript(workspaceRoot, vendorRoot, [
      '--tag',
      'cua-driver-v2',
      '--commit',
      upstream.newCommit,
      '--repo',
      upstream.repoDir,
      '--dry-run'
    ])

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('Dry-run passed')
    expect(
      await readFile(
        path.join(vendorRoot, 'source', 'Sources', 'CuaDriverCLI', 'CuaDriverCommand.swift'),
        'utf8'
      )
    ).toContain('permissionMode = "deepchat"')
  })

  it('dry-run reports conflicts when upstream and DeepChat edit the same source', async () => {
    const oldContent = `let permissionMode = "base"
`
    const newContent = `let permissionMode = "upstream"
`
    const localContent = `let permissionMode = "deepchat"
`
    const upstream = await createUpstreamRepo(oldContent, newContent)
    const workspaceRoot = await makeTempDir('deepchat-cua-workspace-')
    const vendorRoot = await createVendorRoot(
      workspaceRoot,
      upstream.oldCommit,
      upstream.repoDir,
      localContent
    )

    const result = runUpdateScript(workspaceRoot, vendorRoot, [
      '--tag',
      'cua-driver-v2',
      '--commit',
      upstream.newCommit,
      '--repo',
      upstream.repoDir,
      '--dry-run'
    ])

    expect(result.status).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain(
      'Dry-run detected conflicts while applying DeepChat CUA delta.'
    )
  })
})
