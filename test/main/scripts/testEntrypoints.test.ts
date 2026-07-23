import { describe, expect, it, vi } from 'vitest'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const path = await vi.importActual<typeof import('node:path')>('node:path')
const repositoryRoot = process.cwd()
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
) as {
  scripts: Record<string, string>
}
const windowsArm64Workflow = fs.readFileSync(
  path.join(repositoryRoot, '.github/workflows/windows-arm64-e2e.yml'),
  'utf8'
)

describe('test entrypoint contracts', () => {
  it('keeps complete test suites one-shot and watch mode explicit', () => {
    expect(packageJson.scripts).toMatchObject({
      test: 'vitest run',
      'test:main': 'vitest run --config vitest.config.ts test/main',
      'test:renderer': 'vitest run --config vitest.config.renderer.ts test/renderer',
      'test:coverage': 'vitest run --coverage',
      'test:watch': 'vitest --watch'
    })
  })

  it('keeps Native SQLite validation workflow-owned', () => {
    expect(packageJson.scripts).not.toHaveProperty('test:main:native-sqlite')
    expect(
      Object.entries(packageJson.scripts).filter(([, command]) =>
        [
          'DEEPCHAT_REQUIRE_NATIVE_SQLITE',
          'vitest.config.memory-native.ts',
          'rebuild -f -w better-sqlite3'
        ].some((marker) => command.includes(marker))
      )
    ).toEqual([])
  })

  it('keeps the Windows ARM64 workflow aligned with the Native Memory test location', () => {
    const nativeMemoryTest = 'test/main/memory/memoryVectorStoreV2Native.test.ts'

    expect(fs.existsSync(path.join(repositoryRoot, nativeMemoryTest))).toBe(true)
    expect(windowsArm64Workflow).toContain(nativeMemoryTest)
    expect(windowsArm64Workflow).not.toContain(
      'test/main/presenter/memoryVectorStoreV2Native.test.ts'
    )
  })
})
