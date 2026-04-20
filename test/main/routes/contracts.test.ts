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
  chatRespondToolInteractionRoute,
  chatSendMessageRoute,
  chatStopStreamRoute,
  providersListModelsRoute,
  providersTestConnectionRoute,
  sessionsActivateRoute,
  settingsGetSnapshotRoute,
  settingsListSystemFontsRoute,
  settingsUpdateRoute,
  sessionsCreateRoute,
  sessionsDeactivateRoute,
  sessionsGetActiveRoute,
  sessionsListRoute,
  sessionsRestoreRoute,
  systemOpenSettingsRoute
} from '@shared/contracts/routes'

describe('main kernel contracts', () => {
  it('registers the phase1 route catalog', () => {
    expect(Object.keys(DEEPCHAT_ROUTE_CATALOG).sort()).toEqual([
      chatRespondToolInteractionRoute.name,
      chatSendMessageRoute.name,
      chatStopStreamRoute.name,
      providersListModelsRoute.name,
      providersTestConnectionRoute.name,
      sessionsActivateRoute.name,
      sessionsCreateRoute.name,
      sessionsDeactivateRoute.name,
      sessionsGetActiveRoute.name,
      sessionsListRoute.name,
      sessionsRestoreRoute.name,
      settingsGetSnapshotRoute.name,
      settingsListSystemFontsRoute.name,
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

  it('validates typed settings helper routes through the shared contract catalog', () => {
    expect(settingsListSystemFontsRoute.input.parse({})).toEqual({})

    expect(
      settingsListSystemFontsRoute.output.parse({
        fonts: ['Inter', 'JetBrains Mono']
      })
    ).toEqual({
      fonts: ['Inter', 'JetBrains Mono']
    })
  })

  it('validates typed provider and tool interaction routes through the shared contract catalog', () => {
    expect(
      providersListModelsRoute.output.parse({
        providerModels: [
          {
            id: 'gpt-5.4',
            name: 'GPT-5.4',
            group: 'default',
            providerId: 'openai'
          }
        ],
        customModels: []
      })
    ).toEqual({
      providerModels: [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          group: 'default',
          providerId: 'openai'
        }
      ],
      customModels: []
    })

    expect(
      chatRespondToolInteractionRoute.input.parse({
        sessionId: 'session-1',
        messageId: 'message-1',
        toolCallId: 'tool-1',
        response: {
          kind: 'permission',
          granted: true
        }
      })
    ).toEqual({
      sessionId: 'session-1',
      messageId: 'message-1',
      toolCallId: 'tool-1',
      response: {
        kind: 'permission',
        granted: true
      }
    })

    expect(() =>
      providersTestConnectionRoute.input.parse({
        providerId: '',
        modelId: 'gpt-5.4'
      })
    ).toThrow()
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
