import { describe, expect, it, vi } from 'vitest'
import { RemoteConversationRunner } from '@/presenter/remoteControlPresenter/services/remoteConversationRunner'

const createSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  agentId: 'deepchat',
  title: 'Remote Session',
  projectDir: null,
  isPinned: false,
  isDraft: false,
  createdAt: 1,
  updatedAt: 1,
  status: 'idle',
  providerId: 'openai',
  modelId: 'gpt-5',
  ...overrides
})

const createConfigPresenter = (overrides: Record<string, unknown> = {}) => ({
  getAgentType: vi.fn(async (agentId: string) => (agentId === 'acp-agent' ? 'acp' : 'deepchat')),
  getDefaultProjectPath: vi.fn(() => null),
  ...overrides
})

describe('RemoteConversationRunner', () => {
  it('creates new sessions with the current default deepchat agent', async () => {
    const bindingStore = {
      setBinding: vi.fn()
    }
    const runner = new RemoteConversationRunner(
      {
        configPresenter: createConfigPresenter() as any,
        newAgentPresenter: {
          createDetachedSession: vi
            .fn()
            .mockResolvedValue(createSession({ agentId: 'deepchat-alt' }))
        } as any,
        deepchatAgentPresenter: {} as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-alt')
      },
      bindingStore as any
    )

    const session = await runner.createNewSession('telegram:100:0', 'Remote Session')

    expect(session.agentId).toBe('deepchat-alt')
    expect(bindingStore.setBinding).toHaveBeenCalledWith('telegram:100:0', session.id)
  })

  it('keeps using the bound session even after the default agent changes', async () => {
    const newAgentPresenter = {
      createDetachedSession: vi.fn(),
      getSession: vi.fn().mockResolvedValue(
        createSession({
          id: 'session-legacy',
          agentId: 'deepchat-legacy'
        })
      ),
      getMessages: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getMessage: vi.fn().mockResolvedValue({
        id: 'msg-1',
        role: 'assistant',
        content: 'hello from legacy',
        status: 'success',
        orderSeq: 2
      })
    }
    const bindingStore = {
      getBinding: vi.fn().mockReturnValue({
        sessionId: 'session-legacy',
        updatedAt: 1
      }),
      clearBinding: vi.fn(),
      clearActiveEvent: vi.fn(),
      rememberActiveEvent: vi.fn(),
      setBinding: vi.fn()
    }
    const deepchatAgentPresenter = {
      getActiveGeneration: vi.fn().mockReturnValue({
        eventId: 'msg-1',
        runId: 'run-1'
      })
    }
    const runner = new RemoteConversationRunner(
      {
        configPresenter: createConfigPresenter() as any,
        newAgentPresenter: newAgentPresenter as any,
        deepchatAgentPresenter: deepchatAgentPresenter as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-new')
      },
      bindingStore as any
    )

    const execution = await runner.sendText('telegram:100:0', 'hello')

    expect(execution.sessionId).toBe('session-legacy')
    expect(newAgentPresenter.sendMessage).toHaveBeenCalledWith('session-legacy', 'hello')
    expect(newAgentPresenter.createDetachedSession).not.toHaveBeenCalled()
  })

  it('lists recent sessions for the currently bound agent before falling back to default agent', async () => {
    const newAgentPresenter = {
      getSession: vi.fn().mockResolvedValue(
        createSession({
          id: 'session-bound',
          agentId: 'deepchat-bound'
        })
      ),
      getSessionList: vi.fn().mockResolvedValue([
        createSession({
          id: 'session-a',
          agentId: 'deepchat-bound',
          updatedAt: 5
        }),
        createSession({
          id: 'session-b',
          agentId: 'deepchat-bound',
          updatedAt: 10
        })
      ])
    }
    const bindingStore = {
      getBinding: vi.fn().mockReturnValue({
        sessionId: 'session-bound',
        updatedAt: 1
      }),
      rememberSessionSnapshot: vi.fn()
    }
    const runner = new RemoteConversationRunner(
      {
        configPresenter: createConfigPresenter() as any,
        newAgentPresenter: newAgentPresenter as any,
        deepchatAgentPresenter: {} as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-default')
      },
      bindingStore as any
    )

    const sessions = await runner.listSessions('telegram:100:0')

    expect(newAgentPresenter.getSessionList).toHaveBeenCalledWith({
      agentId: 'deepchat-bound'
    })
    expect(sessions.map((session) => session.id)).toEqual(['session-b', 'session-a'])
    expect(bindingStore.rememberSessionSnapshot).toHaveBeenCalledWith('telegram:100:0', [
      'session-b',
      'session-a'
    ])
  })

  it('delegates remote model switching to the bound session', async () => {
    const newAgentPresenter = {
      getSession: vi.fn().mockResolvedValue(
        createSession({
          id: 'session-bound',
          agentId: 'deepchat-bound'
        })
      ),
      setSessionModel: vi.fn().mockResolvedValue(
        createSession({
          id: 'session-bound',
          agentId: 'deepchat-bound',
          providerId: 'anthropic',
          modelId: 'claude-3-5-sonnet'
        })
      )
    }
    const runner = new RemoteConversationRunner(
      {
        configPresenter: createConfigPresenter() as any,
        newAgentPresenter: newAgentPresenter as any,
        deepchatAgentPresenter: {} as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-default')
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-bound',
          updatedAt: 1
        })
      } as any
    )

    const updated = await runner.setSessionModel('telegram:100:0', 'anthropic', 'claude-3-5-sonnet')

    expect(newAgentPresenter.setSessionModel).toHaveBeenCalledWith(
      'session-bound',
      'anthropic',
      'claude-3-5-sonnet'
    )
    expect(updated.providerId).toBe('anthropic')
    expect(updated.modelId).toBe('claude-3-5-sonnet')
  })

  it('returns noSession when /open has no bound session', async () => {
    const runner = new RemoteConversationRunner(
      {
        configPresenter: createConfigPresenter() as any,
        newAgentPresenter: {
          getSession: vi.fn()
        } as any,
        deepchatAgentPresenter: {} as any,
        windowPresenter: {
          getAllWindows: vi.fn(),
          getFocusedWindow: vi.fn(),
          createAppWindow: vi.fn(),
          show: vi.fn()
        } as any,
        tabPresenter: {
          getWindowType: vi.fn()
        } as any,
        resolveDefaultAgentId: vi.fn()
      },
      {
        getBinding: vi.fn().mockReturnValue(null)
      } as any
    )

    await expect(runner.open('telegram:100:0')).resolves.toEqual({
      status: 'noSession'
    })
  })

  it('returns windowNotFound when /open cannot resolve a desktop chat window', async () => {
    const activateSession = vi.fn()
    const createAppWindow = vi.fn().mockResolvedValue(null)
    const show = vi.fn()
    const runner = new RemoteConversationRunner(
      {
        configPresenter: createConfigPresenter() as any,
        newAgentPresenter: {
          getSession: vi.fn().mockResolvedValue(createSession()),
          activateSession
        } as any,
        deepchatAgentPresenter: {} as any,
        windowPresenter: {
          getAllWindows: vi.fn().mockReturnValue([]),
          getFocusedWindow: vi.fn().mockReturnValue(null),
          createAppWindow,
          show
        } as any,
        tabPresenter: {
          getWindowType: vi.fn().mockReturnValue('chat')
        } as any,
        resolveDefaultAgentId: vi.fn()
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-1',
          updatedAt: 1
        }),
        clearBinding: vi.fn()
      } as any
    )

    await expect(runner.open('telegram:100:0')).resolves.toEqual({
      status: 'windowNotFound'
    })
    expect(activateSession).not.toHaveBeenCalled()
    expect(show).not.toHaveBeenCalled()
    expect(createAppWindow).toHaveBeenCalledWith({
      initialRoute: 'chat'
    })
  })

  it('returns ok and activates the bound session when /open resolves a chat window', async () => {
    const session = createSession()
    const activateSession = vi.fn().mockResolvedValue(undefined)
    const show = vi.fn()
    const chatWindow = {
      id: 7,
      webContents: {
        id: 70
      },
      isDestroyed: vi.fn().mockReturnValue(false)
    }
    const runner = new RemoteConversationRunner(
      {
        configPresenter: createConfigPresenter() as any,
        newAgentPresenter: {
          getSession: vi.fn().mockResolvedValue(session),
          activateSession
        } as any,
        deepchatAgentPresenter: {} as any,
        windowPresenter: {
          getAllWindows: vi.fn().mockReturnValue([chatWindow]),
          getFocusedWindow: vi.fn().mockReturnValue(chatWindow),
          createAppWindow: vi.fn(),
          show
        } as any,
        tabPresenter: {
          getWindowType: vi.fn().mockReturnValue('chat')
        } as any,
        resolveDefaultAgentId: vi.fn()
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-1',
          updatedAt: 1
        }),
        clearBinding: vi.fn()
      } as any
    )

    await expect(runner.open('telegram:100:0')).resolves.toEqual({
      status: 'ok',
      session
    })
    expect(activateSession).toHaveBeenCalledWith(70, 'session-1')
    expect(show).toHaveBeenCalledWith(7, true)
  })

  it('does not fall back to the previous active assistant event while waiting for a new reply', async () => {
    vi.useFakeTimers()

    const session = createSession({
      id: 'session-legacy',
      agentId: 'deepchat-legacy',
      status: 'idle'
    })
    const oldAssistantMessage = {
      id: 'msg-old',
      role: 'assistant',
      content: 'old reply',
      status: 'success',
      orderSeq: 2
    }

    const newAgentPresenter = {
      getSession: vi.fn().mockResolvedValue(session),
      getMessages: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'user-1',
            role: 'user',
            content: 'hello',
            status: 'success',
            orderSeq: 1
          }
        ])
        .mockResolvedValue([oldAssistantMessage]),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getMessage: vi.fn().mockResolvedValue(null)
    }
    const bindingStore = {
      getBinding: vi.fn().mockReturnValue({
        sessionId: 'session-legacy',
        updatedAt: 1
      }),
      clearBinding: vi.fn(),
      clearActiveEvent: vi.fn(),
      rememberActiveEvent: vi.fn(),
      setBinding: vi.fn()
    }
    const deepchatAgentPresenter = {
      getActiveGeneration: vi
        .fn()
        .mockReturnValueOnce({
          eventId: 'msg-old',
          runId: 'run-old'
        })
        .mockReturnValue(null)
    }
    const runner = new RemoteConversationRunner(
      {
        configPresenter: createConfigPresenter() as any,
        newAgentPresenter: newAgentPresenter as any,
        deepchatAgentPresenter: deepchatAgentPresenter as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat-new')
      },
      bindingStore as any
    )

    const executionPromise = runner.sendText('telegram:100:0', 'hello again')
    await vi.advanceTimersByTimeAsync(1000)
    const execution = await executionPromise

    expect(execution.eventId).toBeNull()
    expect(bindingStore.rememberActiveEvent).not.toHaveBeenCalledWith('telegram:100:0', 'msg-old')

    const snapshot = await execution.getSnapshot()

    expect(snapshot).toEqual({
      messageId: null,
      text: 'No assistant response was produced.',
      statusText: '',
      finalText: 'No assistant response was produced.',
      draftText: '',
      renderBlocks: [],
      fullText: 'No assistant response was produced.',
      completed: true,
      pendingInteraction: null
    })

    vi.useRealTimers()
  })

  it('extracts the latest pending interaction from assistant action blocks', async () => {
    const runner = new RemoteConversationRunner(
      {
        configPresenter: createConfigPresenter() as any,
        newAgentPresenter: {
          getSession: vi.fn().mockResolvedValue(createSession()),
          sendMessage: vi.fn().mockResolvedValue(undefined),
          getMessages: vi.fn().mockResolvedValue([
            {
              id: 'assistant-1',
              role: 'assistant',
              orderSeq: 2,
              content: JSON.stringify([
                {
                  type: 'content',
                  content: 'Need approval before continuing.',
                  status: 'success',
                  timestamp: 1
                },
                {
                  type: 'action',
                  action_type: 'tool_call_permission',
                  content: 'Permission requested',
                  status: 'pending',
                  timestamp: 2,
                  tool_call: {
                    id: 'tool-1',
                    name: 'shell_command',
                    params: '{"command":"git push"}'
                  },
                  extra: {
                    needsUserAction: true,
                    permissionType: 'command',
                    permissionRequest: JSON.stringify({
                      permissionType: 'command',
                      description: 'Run git push',
                      command: 'git push',
                      commandInfo: {
                        command: 'git push',
                        riskLevel: 'high',
                        suggestion: 'Confirm before pushing.'
                      }
                    })
                  }
                }
              ])
            }
          ])
        } as any,
        deepchatAgentPresenter: {} as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-1',
          updatedAt: 1
        })
      } as any
    )

    await expect(runner.getPendingInteraction('telegram:100:0')).resolves.toEqual({
      type: 'permission',
      messageId: 'assistant-1',
      toolCallId: 'tool-1',
      toolName: 'shell_command',
      toolArgs: '{"command":"git push"}',
      permission: {
        permissionType: 'command',
        description: 'Run git push',
        rememberable: true,
        command: 'git push',
        commandInfo: {
          command: 'git push',
          riskLevel: 'high',
          suggestion: 'Confirm before pushing.'
        }
      }
    })
  })

  it('keeps stream text empty while the assistant is still reasoning', async () => {
    const runner = new RemoteConversationRunner(
      {
        configPresenter: createConfigPresenter() as any,
        newAgentPresenter: {
          getSession: vi.fn().mockResolvedValue(createSession()),
          getMessages: vi.fn().mockResolvedValue([
            {
              id: 'assistant-1',
              role: 'assistant',
              orderSeq: 2,
              status: 'pending',
              content: JSON.stringify([
                {
                  type: 'reasoning_content',
                  content: 'Thinking now',
                  status: 'pending',
                  timestamp: 1
                }
              ])
            }
          ]),
          getMessage: vi.fn().mockResolvedValue({
            id: 'assistant-1',
            role: 'assistant',
            orderSeq: 2,
            status: 'pending',
            content: JSON.stringify([
              {
                type: 'reasoning_content',
                content: 'Thinking now',
                status: 'pending',
                timestamp: 1
              }
            ])
          })
        } as any,
        deepchatAgentPresenter: {
          getActiveGeneration: vi.fn().mockReturnValue({
            eventId: 'assistant-1',
            runId: 'run-1'
          })
        } as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      {
        getBinding: vi.fn().mockReturnValue({
          sessionId: 'session-1',
          updatedAt: 1
        }),
        rememberActiveEvent: vi.fn(),
        clearActiveEvent: vi.fn()
      } as any
    )

    const snapshot = await (runner as any).getConversationSnapshot('telegram:100:0', 'session-1', {
      afterOrderSeq: 0,
      preferredMessageId: null,
      ignoreMessageId: null
    })

    expect(snapshot.text).toBe('')
    expect(snapshot.statusText).toBe('Running: thinking...')
    expect(snapshot.completed).toBe(false)
  })

  it('creates a follow-up execution after responding to a pending interaction', async () => {
    const getMessage = vi.fn().mockResolvedValue({
      id: 'assistant-2',
      role: 'assistant',
      orderSeq: 5,
      status: 'success',
      content: JSON.stringify([
        {
          type: 'content',
          content: 'Push completed.',
          status: 'success',
          timestamp: 2
        }
      ])
    })
    const newAgentPresenter = {
      getSession: vi.fn().mockResolvedValue(createSession()),
      getMessages: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'assistant-2',
            role: 'assistant',
            orderSeq: 5,
            content: JSON.stringify([
              {
                type: 'action',
                action_type: 'tool_call_permission',
                content: 'Permission requested',
                status: 'pending',
                timestamp: 1,
                tool_call: {
                  id: 'tool-2',
                  name: 'shell_command',
                  params: '{"command":"git push"}'
                },
                extra: {
                  needsUserAction: true,
                  permissionType: 'command',
                  permissionRequest: JSON.stringify({
                    permissionType: 'command',
                    description: 'Run git push',
                    command: 'git push'
                  })
                }
              }
            ])
          }
        ])
        .mockResolvedValue([
          {
            id: 'assistant-2',
            role: 'assistant',
            orderSeq: 5,
            status: 'success',
            content: JSON.stringify([
              {
                type: 'content',
                content: 'Push completed.',
                status: 'success',
                timestamp: 2
              }
            ])
          }
        ]),
      respondToolInteraction: vi.fn().mockResolvedValue({
        resumed: true,
        waitingForUserMessage: false
      }),
      getMessage
    }
    const bindingStore = {
      getBinding: vi.fn().mockReturnValue({
        sessionId: 'session-1',
        updatedAt: 1
      }),
      clearActiveEvent: vi.fn(),
      rememberActiveEvent: vi.fn()
    }
    const runner = new RemoteConversationRunner(
      {
        configPresenter: createConfigPresenter() as any,
        newAgentPresenter: newAgentPresenter as any,
        deepchatAgentPresenter: {
          getActiveGeneration: vi.fn().mockReturnValue(null)
        } as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      bindingStore as any
    )

    const response = await runner.respondToPendingInteraction('telegram:100:0', {
      kind: 'permission',
      granted: true
    })

    expect(newAgentPresenter.respondToolInteraction).toHaveBeenCalledWith(
      'session-1',
      'assistant-2',
      'tool-2',
      {
        kind: 'permission',
        granted: true
      }
    )
    expect(response.waitingForUserMessage).toBe(false)

    const snapshot = await response.execution?.getSnapshot()
    expect(snapshot).toEqual({
      messageId: 'assistant-2',
      text: 'Push completed.',
      statusText: 'Running: writing...',
      finalText: 'Push completed.',
      draftText: '',
      renderBlocks: [
        expect.objectContaining({
          kind: 'answer',
          text: '[Answer]\nPush completed.'
        })
      ],
      fullText: '[Answer]\nPush completed.',
      completed: true,
      pendingInteraction: null
    })
  })

  it('creates ACP sessions with provider, model, and channel default workdir', async () => {
    const createDetachedSession = vi.fn().mockResolvedValue(
      createSession({
        agentId: 'acp-agent',
        providerId: 'acp',
        modelId: 'acp-agent',
        projectDir: '/workspaces/remote'
      })
    )
    const runner = new RemoteConversationRunner(
      {
        configPresenter: createConfigPresenter() as any,
        newAgentPresenter: {
          createDetachedSession
        } as any,
        deepchatAgentPresenter: {} as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('acp-agent')
      },
      {
        setBinding: vi.fn(),
        getTelegramConfig: vi.fn().mockReturnValue({
          defaultWorkdir: '/workspaces/remote'
        })
      } as any
    )

    await runner.createNewSession('telegram:100:0', 'Remote ACP')

    expect(createDetachedSession).toHaveBeenCalledWith({
      title: 'Remote ACP',
      agentId: 'acp-agent',
      providerId: 'acp',
      modelId: 'acp-agent',
      projectDir: '/workspaces/remote'
    })
  })

  it('falls back to the global default project path for ACP workdir resolution', async () => {
    const runner = new RemoteConversationRunner(
      {
        configPresenter: createConfigPresenter({
          getDefaultProjectPath: vi.fn(() => '/workspaces/global')
        }) as any,
        newAgentPresenter: {} as any,
        deepchatAgentPresenter: {} as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('acp-agent')
      },
      {
        getTelegramConfig: vi.fn().mockReturnValue({
          defaultWorkdir: ''
        })
      } as any
    )

    await expect(runner.getDefaultWorkdir('telegram:100:0')).resolves.toBe('/workspaces/global')
  })

  it('rejects ACP session creation when neither remote nor global workdir is configured', async () => {
    const runner = new RemoteConversationRunner(
      {
        configPresenter: createConfigPresenter() as any,
        newAgentPresenter: {
          createDetachedSession: vi.fn()
        } as any,
        deepchatAgentPresenter: {} as any,
        windowPresenter: {} as any,
        tabPresenter: {} as any,
        resolveDefaultAgentId: vi.fn().mockResolvedValue('acp-agent')
      },
      {
        getTelegramConfig: vi.fn().mockReturnValue({
          defaultWorkdir: ''
        })
      } as any
    )

    await expect(runner.createNewSession('telegram:100:0')).rejects.toThrow(
      'ACP agent requires a workdir. Set a Remote default directory or global default directory first.'
    )
  })
})
