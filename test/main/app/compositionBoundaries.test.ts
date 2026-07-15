import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

describe('session boundary composition', () => {
  it('reuses one default LegacyChatImportService across startup and skill repair', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const compositionSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/app/composition.ts'),
      'utf8'
    )

    expect(compositionSource.match(/new LegacyChatImportService\(/g)).toHaveLength(1)
    expect(compositionSource).toContain(
      'legacyChatImportService.repairImportedLegacySessionSkills(conversationId)'
    )
    expect(compositionSource).toContain('legacyChatImportService.start(false)')
  })

  it('keeps hooks notifications on one instance with lazy projection dependencies', async () => {
    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const compositionSource = readFileSync(
      path.resolve(process.cwd(), 'src/main/app/composition.ts'),
      'utf8'
    )

    expect(compositionSource.match(/new HookService\(/g)).toHaveLength(1)
    expect(compositionSource).toContain(
      'getSession: (sessionId) => sessionQuery.getSession(sessionId)'
    )
    expect(compositionSource).toContain(
      'getMessage: (messageId) => sessionQuery.getMessage(messageId)'
    )
  })
})
