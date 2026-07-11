import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'

const ROOT = path.resolve(import.meta.dirname, '../../..')
const SCRIPT_PATH = path.join(ROOT, 'scripts/check-shared-declarations.mjs')
const temporaryDirectories: string[] = []

async function createFixture(sourceFile: string, source: string) {
  const directory = await mkdtemp(path.join(tmpdir(), 'deepchat-shared-declarations-'))
  temporaryDirectories.push(directory)
  await mkdir(path.join(directory, 'src/shared'), { recursive: true })
  await writeFile(
    path.join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'esnext',
        moduleResolution: 'bundler',
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: 'es2022'
      },
      include: [`src/shared/${sourceFile}`]
    })
  )
  await writeFile(path.join(directory, 'src/shared', sourceFile), source)
  return directory
}

function runCheck(cwd = ROOT, configs: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...configs], {
    cwd,
    encoding: 'utf8'
  })
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('shared declaration check', () => {
  it('checks the node and web declaration contexts used by the repository', () => {
    const result = runCheck()

    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/tsconfig\.node\.json: \d+ shared declarations passed/)
    expect(result.stdout).toMatch(/tsconfig\.app\.tsgo\.json: \d+ shared declarations passed/)
  })

  it('overrides skipLibCheck and reports repo-owned declaration errors', async () => {
    const directory = await createFixture('broken.d.ts', 'export type Broken = MissingOwner\n')
    const result = runCheck(directory, ['tsconfig.json'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Cannot find name 'MissingOwner'")
  })

  it('checks declarations omitted by the TypeScript project include', async () => {
    const directory = await createFixture('kept.d.ts', 'export type Kept = string\n')
    await writeFile(
      path.join(directory, 'src/shared/omitted.d.ts'),
      'export type Omitted = MissingOwner\n'
    )
    const result = runCheck(directory, ['tsconfig.json'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Cannot find name 'MissingOwner'")
  })

  it('fails closed when the configured shared declaration roots disappear', async () => {
    const directory = await createFixture('index.ts', 'export const value = true\n')
    const result = runCheck(directory, ['tsconfig.json'])

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('no declarations found under src/shared')
  })
})
