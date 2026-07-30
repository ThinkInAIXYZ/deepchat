import { describe, expect, it } from 'vitest'
import {
  resolveSemanticNotification,
  semanticNotificationDeliverySchema,
  semanticNotificationIntentSchema
} from '@shared/notifications'

describe('semantic notification contract', () => {
  it('derives stable per-server episodes and a shared MCP aggregation scope', () => {
    const first = resolveSemanticNotification({
      code: 'mcp.connectionFailed',
      serverName: '  filesystem  '
    })
    const repeated = resolveSemanticNotification({
      code: 'mcp.connectionFailed',
      serverName: 'filesystem'
    })

    expect(first).toEqual(repeated)
    expect(first).toMatchObject({
      episodeIdentity: '["mcp.connectionFailed","filesystem"]',
      priority: 40,
      routing: {
        compatibility: 'any',
        preferredTarget: 'main',
        waitWhenUnavailable: false
      },
      presentation: {
        kind: 'error',
        key: 'filesystem',
        scope: 'mcp.connection',
        entity: 'filesystem'
      }
    })
  })

  it('keeps data-integrity actions pending until explicit resolution', () => {
    const resolved = resolveSemanticNotification({
      code: 'databaseSecurity.repairSuggested',
      reason: 'missing-column',
      dedupeKey: 'agent-db-schema'
    })

    expect(resolved).toMatchObject({
      priority: 80,
      routing: {
        preferredTarget: 'settings',
        waitWhenUnavailable: true,
        pendingTtlMs: Infinity
      },
      presentation: {
        kind: 'actionable',
        retention: 'until-resolved',
        action: {
          kind: 'open-settings',
          routeName: 'settings-database',
          section: 'database-repair'
        }
      }
    })
    expect(resolved.quietTtlMs).toBeUndefined()
  })

  it('uses bounded inferred recovery only for one-shot provider failures', () => {
    const resolved = resolveSemanticNotification({
      code: 'providerDeeplink.failed',
      reason: 'invalid-payload'
    })

    expect(resolved.quietTtlMs).toBe(30_000)
    expect(resolved.routing.waitWhenUnavailable).toBe(false)
  })

  it('rejects arbitrary copy and raw error-shaped fields at the shared boundary', () => {
    expect(() =>
      semanticNotificationIntentSchema.parse({
        code: 'mcp.toolListFailed',
        serverName: 'filesystem',
        title: 'Failed',
        message: 'raw exception'
      })
    ).toThrow()
  })

  it('requires a closed intent for occurrence deliveries', () => {
    expect(() =>
      semanticNotificationDeliverySchema.parse({
        kind: 'occur',
        episodeId: 'episode-1',
        intent: {
          code: 'unknown.failure'
        }
      })
    ).toThrow()

    expect(
      semanticNotificationDeliverySchema.parse({
        kind: 'recover',
        episodeId: 'episode-1'
      })
    ).toEqual({
      kind: 'recover',
      episodeId: 'episode-1'
    })
  })
})
