import {
  DEEPCHAT_EVENT_CATALOG,
  chatStreamCompletedEvent,
  chatStreamFailedEvent,
  chatStreamUpdatedEvent,
  settingsChangedEvent,
  sessionsUpdatedEvent
} from '@shared/contracts/events'
import {
  DEEPCHAT_ROUTE_CATALOG,
  chatSendMessageRoute,
  chatStopStreamRoute,
  settingsGetSnapshotRoute,
  settingsUpdateRoute,
  sessionsCreateRoute,
  sessionsListRoute,
  sessionsRestoreRoute,
  systemOpenSettingsRoute
} from '@shared/contracts/routes'

describe('main kernel contracts', () => {
  it('registers the phase1 route catalog', () => {
    expect(Object.keys(DEEPCHAT_ROUTE_CATALOG).sort()).toEqual([
      chatSendMessageRoute.name,
      chatStopStreamRoute.name,
      sessionsCreateRoute.name,
      sessionsListRoute.name,
      sessionsRestoreRoute.name,
      settingsGetSnapshotRoute.name,
      settingsUpdateRoute.name,
      systemOpenSettingsRoute.name
    ])
  })

  it('validates typed settings updates through the shared route contract', () => {
    expect(() =>
      settingsUpdateRoute.input.parse({
        changes: [{ key: 'fontSizeLevel', value: 'wrong-type' }]
      })
    ).toThrow()

    expect(
      settingsUpdateRoute.input.parse({
        changes: [
          { key: 'fontSizeLevel', value: 3 },
          { key: 'notificationsEnabled', value: true }
        ]
      })
    ).toEqual({
      changes: [
        { key: 'fontSizeLevel', value: 3 },
        { key: 'notificationsEnabled', value: true }
      ]
    })
  })

  it('registers the phase1 typed event catalog', () => {
    expect(Object.keys(DEEPCHAT_EVENT_CATALOG).sort()).toEqual([
      chatStreamCompletedEvent.name,
      chatStreamFailedEvent.name,
      chatStreamUpdatedEvent.name,
      sessionsUpdatedEvent.name,
      settingsChangedEvent.name
    ])
  })

  it('validates typed chat stream payloads', () => {
    expect(() =>
      chatStreamUpdatedEvent.payload.parse({
        kind: 'snapshot',
        requestId: 'req-1',
        sessionId: 'session-1',
        messageId: 'message-1',
        updatedAt: Date.now(),
        blocks: [
          {
            type: 'content',
            status: 'success',
            timestamp: Date.now(),
            content: 'hello'
          }
        ]
      })
    ).not.toThrow()

    expect(() =>
      chatStreamFailedEvent.payload.parse({
        requestId: 'req-1',
        sessionId: 'session-1',
        messageId: 'message-1',
        failedAt: Date.now()
      })
    ).toThrow()
  })
})
