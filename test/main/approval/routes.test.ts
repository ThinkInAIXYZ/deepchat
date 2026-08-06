import { describe, expect, it, vi } from 'vitest'
import { approvalsResolveRoute } from '@shared/contracts/routes'
import { createApprovalRoutes } from '@/approval'

describe('approval routes', () => {
  it('passes a validated decision and renderer identity to the resolver', async () => {
    const resolve = vi.fn(() => true)
    const routes = createApprovalRoutes({ resolve })
    const handler = routes.get(approvalsResolveRoute.name)!

    await expect(
      handler(
        { requestId: 'approval-request-1234', decision: 'approved' },
        { caller: { kind: 'renderer', webContentsId: 12, windowId: 3 } }
      )
    ).resolves.toEqual({ accepted: true })
    expect(resolve).toHaveBeenCalledWith(
      { requestId: 'approval-request-1234', decision: 'approved' },
      { kind: 'renderer', webContentsId: 12, windowId: 3 }
    )
  })

  it('rejects CLI callers before resolution', async () => {
    const resolve = vi.fn(() => true)
    const routes = createApprovalRoutes({ resolve })
    const handler = routes.get(approvalsResolveRoute.name)!

    await expect(
      handler(
        { requestId: 'approval-request-1234', decision: 'denied' },
        {
          caller: {
            kind: 'cli',
            principal: 'human',
            connectionId: 'connection-1',
            scopes: []
          }
        }
      )
    ).rejects.toThrow('Route requires a renderer caller')
    expect(resolve).not.toHaveBeenCalled()
  })
})
