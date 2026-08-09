import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionPermissionPort } from '@/app/sessionPermissionAdapter'
import type { SessionPermissionRequest } from '@/session/contracts'

describe('createSessionPermissionPort', () => {
  const agentCliTokenAuthority = {
    revokeConversation: vi.fn()
  }
  const commandPermissionService = {
    approve: vi.fn(),
    clearConversation: vi.fn(),
    cloneConversation: vi.fn(),
    revokeOnce: vi.fn()
  }
  const filePermissionService = {
    approve: vi.fn(),
    clearConversation: vi.fn(),
    cloneConversation: vi.fn()
  }
  const settingsPermissionService = {
    approve: vi.fn(),
    clearConversation: vi.fn(),
    cloneConversation: vi.fn()
  }
  const toolPermissionBroker = {
    approve: vi.fn(),
    cancelConversation: vi.fn(),
    deny: vi.fn()
  }

  const createPort = () =>
    createSessionPermissionPort({
      agentCliTokenAuthority,
      commandPermissionService,
      filePermissionService,
      settingsPermissionService,
      toolPermissionBroker
    })

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it.each([
    ['a missing signature', { shellProfile: 'git-bash' }],
    ['a missing profile', { commandSignature: 'git-bash:npm install' }],
    [
      'a signature from another profile',
      { commandSignature: 'posix:npm install', shellProfile: 'git-bash' }
    ],
    [
      'an unknown profile namespace',
      { commandSignature: 'future-shell:npm install', shellProfile: 'future-shell' }
    ]
  ] as const)('rejects command approval with %s', async (_label, fields) => {
    const port = createPort()
    const permission = {
      permissionType: 'command',
      requestId: 'unrelated-tool-request',
      ...fields
    } as SessionPermissionRequest

    await expect(port.approvePermission('session-1', permission)).rejects.toThrow(
      'Command approval is missing a valid shell profile and signature.'
    )
    expect(commandPermissionService.approve).not.toHaveBeenCalled()
    expect(toolPermissionBroker.approve).not.toHaveBeenCalled()
  })

  it('issues a one-shot grant only for the stored profile namespace', async () => {
    commandPermissionService.approve.mockReturnValueOnce('grant-1')
    const port = createPort()

    await expect(
      port.approvePermission('session-1', {
        permissionType: 'command',
        requestId: 'unrelated-tool-request',
        commandSignature: '  git-bash:npm install  ',
        shellProfile: 'git-bash'
      })
    ).resolves.toEqual({
      kind: 'command',
      signature: 'git-bash:npm install',
      oneShotGrantId: 'grant-1'
    })

    expect(commandPermissionService.approve).toHaveBeenCalledWith(
      'session-1',
      'git-bash:npm install',
      false
    )
    expect(toolPermissionBroker.approve).not.toHaveBeenCalled()
  })

  it('fails closed when command approval cannot issue a lease', async () => {
    commandPermissionService.approve.mockReturnValueOnce(null)
    const port = createPort()

    await expect(
      port.approvePermission('session-1', {
        permissionType: 'command',
        commandSignature: 'posix:npm install',
        shellProfile: 'posix'
      })
    ).rejects.toThrow('Command approval did not return a one-shot grant lease.')
  })

  it('returns a non-command grant without a lease', async () => {
    toolPermissionBroker.approve.mockReturnValueOnce(true)
    const port = createPort()

    await expect(
      port.approvePermission('session-1', {
        permissionType: 'write',
        requestId: 'request-1'
      })
    ).resolves.toEqual({ kind: 'granted' })
  })

  it('grants deferred filesystem paths without issuing a command lease', async () => {
    const port = createPort()

    await expect(
      port.approvePermission('session-1', {
        permissionType: 'write',
        serverName: 'agent-filesystem',
        toolName: 'write',
        paths: ['/workspace/note.txt'],
        shellProfile: 'posix'
      })
    ).resolves.toEqual({ kind: 'granted' })

    expect(filePermissionService.approve).toHaveBeenCalledWith(
      'session-1',
      ['/workspace/note.txt'],
      'write',
      false
    )
    expect(commandPermissionService.approve).not.toHaveBeenCalled()
  })

  it('grants deferred settings tools without issuing a command lease', async () => {
    const port = createPort()

    await expect(
      port.approvePermission('session-1', {
        permissionType: 'write',
        serverName: 'deepchat-settings',
        toolName: 'set_language'
      })
    ).resolves.toEqual({ kind: 'granted' })

    expect(settingsPermissionService.approve).toHaveBeenCalledWith(
      'session-1',
      'set_language',
      false
    )
    expect(commandPermissionService.approve).not.toHaveBeenCalled()
  })
})
