import { expect, it, vi } from 'vitest'
import { DimSkillContext } from '@/agent/dim/skillContext'

it('revokes a private skill read when its Agent changes during preparation', async () => {
  let finish!: (value: { success: boolean; content: string; skillRoot: string }) => void
  let agentId = 'private-a'
  const view = vi.fn(
    () =>
      new Promise<{ success: boolean; content: string; skillRoot: string }>((resolve) => {
        finish = resolve
      })
  )
  const context = new DimSkillContext({
    session: () => ({ agentId, projectDir: '/project' }),
    skills: {
      getActiveSkills: async () => ['private'],
      getMetadataList: async () => [
        {
          name: 'private',
          description: 'Private instructions',
          path: '/private/SKILL.md',
          skillRoot: '/private'
        }
      ],
      viewSkillForAgent: view
    }
  })
  const pending = context.contribute(
    { sessionId: 'session' } as never,
    new AbortController().signal
  )
  await vi.waitFor(() => expect(view).toHaveBeenCalledOnce())
  agentId = 'private-b'
  finish({ success: true, content: 'PRIVATE_A_SECRET', skillRoot: '/private' })
  await expect(pending).rejects.toThrow('replaced Agent or workspace')
})

it('keeps unselected private catalogs out of the native context budget', async () => {
  const metadata = vi.fn()
  const view = vi.fn()
  const context = new DimSkillContext({
    session: () => ({ agentId: 'private', projectDir: '/project' }),
    skills: { getActiveSkills: async () => [], getMetadataList: metadata, viewSkillForAgent: view }
  })
  await expect(
    context.contribute({ sessionId: 'session' } as never, new AbortController().signal)
  ).resolves.toEqual({ messages: [], receipts: [] })
  expect(metadata).not.toHaveBeenCalled()
  expect(view).not.toHaveBeenCalled()
})
