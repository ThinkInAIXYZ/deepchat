import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { coalesceWatcherEvents } from '../../../../src/main/lib/fileWatcher/eventCoalescer'

describe('coalesceWatcherEvents', () => {
  it('drops create/delete pairs for the same path', () => {
    expect(
      coalesceWatcherEvents([
        { type: 'create', path: '/tmp/work/a.ts' },
        { type: 'delete', path: '/tmp/work/a.ts' }
      ])
    ).toEqual([])
  })

  it('turns delete/create pairs into an update', () => {
    expect(
      coalesceWatcherEvents([
        { type: 'delete', path: '/tmp/work/a.ts' },
        { type: 'create', path: '/tmp/work/a.ts' }
      ])
    ).toEqual([{ type: 'update', path: '/tmp/work/a.ts' }])
  })

  it('keeps parent deletes and drops duplicate child deletes', () => {
    const root = path.join('/tmp', 'work')
    expect(
      coalesceWatcherEvents([
        { type: 'delete', path: path.join(root, 'dir', 'nested.ts') },
        { type: 'delete', path: path.join(root, 'dir') }
      ])
    ).toEqual([{ type: 'delete', path: path.join(root, 'dir') }])
  })
})
