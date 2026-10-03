import { describe, expect, it } from 'vitest'
import { FileReference } from '@/components/chat/nodes/fileReference'

describe('fileReference node', () => {
  it('imports only references whose relative path matches the canonical file path', () => {
    const parseRule = FileReference.config.parseHTML?.call(FileReference)?.[0]
    const valid = document.createElement('span')
    valid.setAttribute('data-file-reference', '')
    valid.setAttribute('data-filePath', '/repo/src/App.vue')
    valid.setAttribute('data-relativePath', 'src/App.vue')
    const mismatched = valid.cloneNode() as HTMLElement
    mismatched.setAttribute('data-filePath', '/repo/secrets.txt')

    expect(parseRule?.getAttrs?.(valid)).toEqual({
      filePath: '/repo/src/App.vue',
      relativePath: 'src/App.vue'
    })
    expect(parseRule?.getAttrs?.(mismatched)).toBe(false)
  })
})
