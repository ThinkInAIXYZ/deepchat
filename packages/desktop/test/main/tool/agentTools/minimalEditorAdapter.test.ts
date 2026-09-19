import { describe, expect, it } from 'vitest'
import {
  applyUpdateChunks,
  formatStrReplaceFileView,
  lineNumbersAt,
  matchOffsets,
  parseApplyPatch
} from '@/tool/agentTools/minimalEditorAdapter'

describe('minimal editor adapters', () => {
  it('parses and applies ordered V4A update chunks', () => {
    const [operation] = parseApplyPatch(`*** Begin Patch
*** Update File: src/example.ts
@@
-const first = 1
+const first = 2
@@ function run() {
-  return first
+  return first + 1
 }
*** End Patch`)

    expect(operation).toMatchObject({
      type: 'update',
      path: 'src/example.ts'
    })
    if (operation.type !== 'update') throw new Error('Expected an update operation.')
    expect(
      applyUpdateChunks(
        'const first = 1\n\nfunction run() {\n  return first\n}\n',
        operation.path,
        operation.chunks
      )
    ).toBe('const first = 2\n\nfunction run() {\n  return first + 1\n}\n')
  })

  it('preserves add, delete, and move operations as distinct patch actions', () => {
    expect(
      parseApplyPatch(`*** Begin Patch
*** Add File: added.txt
+hello
*** Delete File: removed.txt
*** Update File: old.txt
*** Move to: new.txt
@@
-old
+new
*** End Patch`)
    ).toEqual([
      { type: 'add', path: 'added.txt', content: 'hello\n' },
      { type: 'delete', path: 'removed.txt' },
      {
        type: 'update',
        path: 'old.txt',
        movePath: 'new.txt',
        chunks: [
          {
            oldLines: ['old'],
            newLines: ['new'],
            endOfFile: false
          }
        ]
      }
    ])
  })

  it('keeps multiple append-only chunks in patch order', () => {
    expect(
      applyUpdateChunks('start\n', 'file.txt', [
        { oldLines: [], newLines: ['first'], endOfFile: false },
        { oldLines: [], newLines: ['second'], endOfFile: false }
      ])
    ).toBe('start\nfirst\nsecond\n')
  })

  it('inserts append-only chunks after their change context', () => {
    expect(
      applyUpdateChunks('before\nsection\nafter\n', 'file.txt', [
        {
          changeContext: 'section',
          oldLines: [],
          newLines: ['inserted'],
          endOfFile: false
        }
      ])
    ).toBe('before\nsection\ninserted\nafter\n')
  })

  it('finds every literal match and reports one-based line numbers', () => {
    const content = 'alpha\nbeta alpha\nalpha\n'
    const offsets = matchOffsets(content, 'alpha')

    expect(offsets).toEqual([0, 11, 17])
    expect(lineNumbersAt(content, offsets)).toEqual([1, 2, 3])
  })

  it('formats the requested one-based view range', () => {
    expect(formatStrReplaceFileView('/work/file.txt', 'one\ntwo\nthree', [2, 3])).toContain(
      '     2  two\n     3  three'
    )
    expect(() => formatStrReplaceFileView('/work/file.txt', 'one\ntwo', [0, 1])).toThrow(
      'first element'
    )
  })
})
