import { describe, expect, it } from 'vitest'
import {
  buildFloatingWidgetSnapshot,
  getPeekedCollapsedBounds,
  getCollapsedWidgetSize,
  getExpandedWidgetSize,
  repositionWidgetForResize,
  snapWidgetBoundsToEdge
} from '@/presenter/floatingButtonPresenter/layout'

describe('floating widget layout helpers', () => {
  it('sorts deepchat sessions with in-progress sessions first', () => {
    const snapshot = buildFloatingWidgetSnapshot(
      [
        {
          id: 'done-1',
          agentId: 'deepchat',
          title: 'Done session',
          projectDir: null,
          isPinned: false,
          isDraft: false,
          createdAt: 1,
          updatedAt: 10,
          status: 'idle',
          providerId: 'openai',
          modelId: 'gpt-5.4'
        },
        {
          id: 'running-1',
          agentId: 'deepchat',
          title: 'Running session',
          projectDir: null,
          isPinned: false,
          isDraft: false,
          createdAt: 1,
          updatedAt: 9,
          status: 'generating',
          providerId: 'openai',
          modelId: 'gpt-5.4'
        },
        {
          id: 'acp-1',
          agentId: 'acp-agent',
          title: 'Ignore me',
          projectDir: null,
          isPinned: false,
          isDraft: false,
          createdAt: 1,
          updatedAt: 99,
          status: 'generating',
          providerId: 'acp',
          modelId: 'acp-agent'
        }
      ],
      false
    )

    expect(snapshot.activeCount).toBe(1)
    expect(snapshot.sessions.map((session) => session.id)).toEqual(['running-1', 'done-1'])
    expect(snapshot.sessions.map((session) => session.status)).toEqual(['in_progress', 'done'])
  })

  it('keeps the right edge fixed when resizing a right-docked widget', () => {
    const nextBounds = repositionWidgetForResize(
      {
        x: 800,
        y: 120,
        width: getCollapsedWidgetSize(0).width,
        height: getCollapsedWidgetSize(0).height
      },
      getExpandedWidgetSize(4),
      {
        x: 0,
        y: 0,
        width: 864,
        height: 900
      },
      'right'
    )

    expect(nextBounds.x + nextBounds.width).toBe(864)
    expect(nextBounds.y).toBe(120)
  })

  it('hides half of the collapsed widget outside the work area when idle', () => {
    const peekedBounds = getPeekedCollapsedBounds(
      {
        x: 800,
        y: 120,
        width: getCollapsedWidgetSize(0).width,
        height: getCollapsedWidgetSize(0).height
      },
      {
        x: 0,
        y: 0,
        width: 864,
        height: 900
      },
      'right'
    )

    expect(peekedBounds.x).toBe(832)
    expect(peekedBounds.y).toBe(120)
  })

  it('snaps dropped widget bounds to the nearest horizontal edge and clamps Y', () => {
    const snapped = snapWidgetBoundsToEdge(
      {
        x: 1100,
        y: 820,
        width: 102,
        height: 56
      },
      {
        x: 960,
        y: 0,
        width: 960,
        height: 800
      }
    )

    expect(snapped.dockSide).toBe('left')
    expect(snapped.x).toBe(960)
    expect(snapped.y).toBe(744)
  })
})
