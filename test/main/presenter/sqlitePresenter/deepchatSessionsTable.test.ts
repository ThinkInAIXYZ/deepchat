import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeepChatSessionsTable } from '@/presenter/sqlitePresenter/tables/deepchatSessions'

describe('DeepChatSessionsTable.updateSummaryStateIfMatches', () => {
  const run = vi.fn()
  const prepare = vi.fn()
  const db = {
    prepare
  } as any

  let table: DeepChatSessionsTable

  beforeEach(() => {
    run.mockReset()
    prepare.mockReset()
    prepare.mockReturnValue({ run })
    table = new DeepChatSessionsTable(db)
  })

  it('uses an atomic guarded update and returns true when sqlite reports a write', () => {
    run.mockReturnValue({ changes: 1 })

    const applied = table.updateSummaryStateIfMatches(
      's1',
      {
        summaryText: 'fresh summary',
        summaryCursorOrderSeq: 3,
        summaryUpdatedAt: 111
      },
      {
        summaryText: null,
        summaryCursorOrderSeq: 1,
        summaryUpdatedAt: null
      }
    )

    expect(applied).toBe(true)
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE deepchat_sessions'))
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining('AND summary_cursor_order_seq = ?')
    )
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining('summary_text IS NULL AND ? IS NULL')
    )
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining('summary_updated_at IS NULL AND ? IS NULL')
    )
    expect(run).toHaveBeenCalledWith('fresh summary', 3, 111, 's1', 1, null, null, null, null)
  })

  it('returns false when sqlite reports that the guarded update did not apply', () => {
    run.mockReturnValue({ changes: 0 })

    const applied = table.updateSummaryStateIfMatches(
      's1',
      {
        summaryText: 'stale summary',
        summaryCursorOrderSeq: 3,
        summaryUpdatedAt: 111
      },
      {
        summaryText: null,
        summaryCursorOrderSeq: 1,
        summaryUpdatedAt: null
      }
    )

    expect(applied).toBe(false)
    expect(run).toHaveBeenCalledOnce()
  })
})
