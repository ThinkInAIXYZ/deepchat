import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createRendererRouteCaller,
  createRendererRouteContext,
  projectJsonRouteOutput,
  requireRendererCaller,
  type RouteContext
} from '@/routes/routeRegistry'

describe('route caller context', () => {
  it('wraps renderer identity in a discriminated caller', () => {
    const caller = createRendererRouteCaller(42, 7)

    expect(caller).toEqual({
      kind: 'renderer',
      webContentsId: 42,
      windowId: 7
    })
    expect(createRendererRouteContext(42, null)).toEqual({
      caller: {
        kind: 'renderer',
        webContentsId: 42,
        windowId: null
      }
    })
  })

  it('returns renderer identity at renderer boundaries', () => {
    const context = createRendererRouteContext(42, 7)

    expect(requireRendererCaller(context)).toBe(context.caller)
  })

  it('projects route outputs before normalizing them for JSON', () => {
    const outputSchema = z.object({
      required: z.string(),
      optional: z.string().optional(),
      nested: z.object({ optional: z.boolean().optional() })
    })
    const privateValue = {
      toJSON: () => {
        throw new Error('Private values must be removed before serialization')
      }
    }

    expect(
      projectJsonRouteOutput(outputSchema, {
        required: 'visible',
        optional: undefined,
        nested: { optional: undefined, privateValue },
        privateValue
      })
    ).toEqual({ required: 'visible', nested: {} })
  })

  it.each<RouteContext>([
    {
      caller: {
        kind: 'cli',
        principal: 'human',
        connectionId: 'connection-1',
        scopes: ['system:read']
      }
    },
    {
      caller: {
        kind: 'cli',
        principal: 'agent',
        connectionId: 'connection-2',
        tokenId: 'token-id-session-1',
        scopes: ['models:invoke'],
        conversationId: 'session-1',
        expiresAt: Date.now() + 60_000
      }
    },
    {
      caller: {
        kind: 'internal',
        component: 'scheduler'
      }
    }
  ])('rejects non-renderer identity %# at renderer boundaries', (context) => {
    expect(() => requireRendererCaller(context)).toThrow('Route requires a renderer caller')
  })
})
