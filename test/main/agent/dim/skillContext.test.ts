import { expect, it, vi } from 'vitest'
import { DimSkillContext } from '@/agent/dim/skillContext'

const catalog = () => ({
  publish: vi.fn(async () => ({ path: '/native/skills.json', catalogHash: 'hash', fileId: 'file' }))
})

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
    catalog: catalog(),
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

it('offers only the authorized private catalog for native on-demand loading without reading bodies', async () => {
  const metadata = vi.fn(async () => [
    {
      name: 'private',
      description: 'Private instructions',
      path: '/private/SKILL.md',
      skillRoot: '/private'
    }
  ])
  const view = vi.fn()
  const context = new DimSkillContext({
    catalog: catalog(),
    session: () => ({ agentId: 'private', projectDir: '/project' }),
    skills: { getActiveSkills: async () => [], getMetadataList: metadata, viewSkillForAgent: view }
  })
  const result = await context.contribute(
    { sessionId: 'session' } as never,
    new AbortController().signal
  )
  expect(result.messages).toEqual([
    { role: 'user', content: expect.stringContaining('/native/skills.json') }
  ])
  expect(result.messages[0].content).toContain('dim read')
  expect(metadata).toHaveBeenCalledWith('private', { conversationId: 'session' })
  expect(result.receipts).toEqual([
    expect.objectContaining({ source: 'deepchat/skills', selected: [] })
  ])
  expect(view).not.toHaveBeenCalled()
})

it('rejects private catalog revocation before its paths reach native context', async () => {
  const metadata = vi
    .fn()
    .mockResolvedValueOnce([
      {
        name: 'private',
        description: 'Private instructions',
        path: '/private/SKILL.md',
        skillRoot: '/private'
      }
    ])
    .mockResolvedValueOnce([])
  const context = new DimSkillContext({
    catalog: catalog(),
    session: () => ({ agentId: 'private', projectDir: '/project' }),
    skills: {
      getActiveSkills: async () => [],
      getMetadataList: metadata,
      viewSkillForAgent: vi.fn()
    }
  })
  await expect(
    context.contribute({ sessionId: 'session' } as never, new AbortController().signal)
  ).rejects.toThrow('Assigned skill catalog changed')
})

it('does not adopt a catalog revoked while native Session files publish it', async () => {
  let available = true
  const context = new DimSkillContext({
    session: () => ({ agentId: 'private', projectDir: '/project' }),
    catalog: {
      publish: async () => {
        available = false
        return { path: '/native/skills.json', catalogHash: 'hash', fileId: 'file' }
      }
    },
    skills: {
      getActiveSkills: async () => [],
      getMetadataList: async () =>
        available
          ? [
              {
                name: 'private',
                description: 'Private',
                path: '/private/SKILL.md',
                skillRoot: '/private'
              }
            ]
          : [],
      viewSkillForAgent: vi.fn()
    }
  })
  await expect(
    context.contribute({ sessionId: 'session' } as never, new AbortController().signal)
  ).rejects.toThrow('changed during publication')
})
