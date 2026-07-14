import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

describe('session boundary composition', () => {
  it('reuses one default LegacyChatImportService across startup and skill repair', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const presenterSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/presenter/index.ts'),
      'utf8'
    )
    const legacyHookSource = readFileSync(
      path.resolve(
        process.cwd(),
        'src/main/presenter/lifecyclePresenter/hooks/after-start/legacyImportHook.ts'
      ),
      'utf8'
    )

    expect(presenterSource.match(/new LegacyChatImportService\(/g)).toHaveLength(1)
    expect(presenterSource).toContain(
      'this.legacyChatImportService.repairImportedLegacySessionSkills(conversationId)'
    )
    expect(legacyHookSource).toContain('presenter.legacyChatImportService.start(false)')
  })

  it('keeps hooks notifications on one instance with lazy projection dependencies', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const presenterSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/presenter/index.ts'),
      'utf8'
    )

    expect(presenterSource.match(/new HooksNotificationsService\(/g)).toHaveLength(1)
    expect(presenterSource).toContain(
      'getSession: (sessionId) => this.sessionProjectionCoordinator.getSession(sessionId)'
    )
    expect(presenterSource).toContain(
      'getMessage: (messageId) => this.sessionProjectionCoordinator.getMessage(messageId)'
    )
  })
})
