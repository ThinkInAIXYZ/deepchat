import { describe, expect, it } from 'vitest'
import { serializeComposerDocument } from '@/features/chat-page/model/composerDocumentSerialization'
import { createComposerTextDocument } from '@/features/chat-page/model/composerDraftState'
import type { UserMessageInlineItem } from '@shared/types/agent-interface'
import { getReferencePathLabels } from '@shared/messageInlineItems'

describe('composer document serialization', () => {
  it('round-trips asymmetric non-ASCII file and session offsets', () => {
    const text = '甲🙂@src/组件.vue后\n尾声'
    const inlineItems: UserMessageInlineItem[] = [
      {
        type: 'file-reference',
        offset: 3,
        filePath: '/repo/src/组件.vue',
        relativePath: 'src/组件.vue'
      },
      {
        type: 'session',
        offset: 17,
        sessionId: 'source',
        title: '来源',
        projectDir: '/repo',
        tapeIncarnationId: 'inc-source'
      }
    ]

    const serialized = serializeComposerDocument(createComposerTextDocument(text, inlineItems))

    expect(serialized).toEqual({ text, inlineItems })
  })

  it('leaves stale file-reference wire text intact instead of replacing it with an atom', () => {
    const text = 'keep @src/new.ts unchanged'
    const stale: UserMessageInlineItem = {
      type: 'file-reference',
      offset: 5,
      filePath: '/repo/src/old.ts',
      relativePath: 'src/old.ts'
    }

    expect(serializeComposerDocument(createComposerTextDocument(text, [stale]))).toEqual({
      text,
      inlineItems: []
    })
  })

  it('disambiguates same-name references with the shortest distinct parent path', () => {
    const peers = ['src/client/index.ts', 'src/server/index.ts', 'test/index.ts']

    expect([...getReferencePathLabels(peers).values()]).toEqual([
      'client/index.ts',
      'server/index.ts',
      'test/index.ts'
    ])
    expect([
      ...getReferencePathLabels(['src/foo.ts', 'test/src/foo.ts', 'test/src/foo.ts']).values()
    ]).toEqual(['src/foo.ts', 'test/src/foo.ts'])
  })

  it('degrades mismatched file identities to their original text', () => {
    expect(
      serializeComposerDocument(
        createComposerTextDocument('@README.md', [
          {
            type: 'file-reference',
            offset: 0,
            filePath: '/etc/passwd',
            relativePath: 'README.md'
          }
        ])
      )
    ).toEqual({ text: '@README.md', inlineItems: [] })
  })
})
