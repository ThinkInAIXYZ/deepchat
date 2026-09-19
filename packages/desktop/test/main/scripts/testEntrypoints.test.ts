import { describe, expect, it, vi } from 'vitest'

const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
const path = await vi.importActual<typeof import('node:path')>('node:path')
const url = await vi.importActual<typeof import('node:url')>('node:url')
const repositoryRoot = url.fileURLToPath(new URL('../../../../..', import.meta.url))
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
      test: 'pnpm run test:mcp:artifact && pnpm --filter DeepChat exec vitest run --config ../../vitest.config.ts',
      'test:main': 'pnpm run test:mcp:artifact && pnpm --filter DeepChat exec vitest run --config ../../vitest.config.ts --project main --project kernel --project shared --project mcp --project artifact',
      'test:renderer': 'pnpm --filter DeepChat run test:renderer',
      'test:coverage': 'pnpm run test:mcp:artifact && pnpm --filter DeepChat exec vitest run --config ../../vitest.config.ts --coverage',
      'test:artifact': 'pnpm --filter DeepChat exec vitest run --config ../../vitest.config.ts --project artifact',
      'test:watch': 'pnpm --filter DeepChat exec vitest --config ../../vitest.config.ts --watch',
      'test:ui': 'pnpm --filter DeepChat exec vitest --config ../../vitest.config.ts --ui'
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
    const nativeMemoryTest = 'packages/desktop/test/main/memory/memoryVectorStoreV2Native.test.ts'

    expect(fs.existsSync(path.join(repositoryRoot, nativeMemoryTest))).toBe(true)
    expect(windowsArm64Workflow).toContain(nativeMemoryTest.slice('packages/desktop/'.length))
    expect(windowsArm64Workflow).not.toContain(
      'packages/desktop/test/main/presenter/memoryVectorStoreV2Native.test.ts'
    )
  })
})
