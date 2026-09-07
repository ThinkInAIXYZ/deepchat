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
    approveProvisional: vi.fn(),
    clearConversation: vi.fn(),
    cloneConversation: vi.fn(),
    finalizeProvisional: vi.fn(),
    revokeProvisional: vi.fn()
  }
  const settingsPermissionService = {
    approveProvisional: vi.fn(),
    clearConversation: vi.fn(),
    cloneConversation: vi.fn(),
    finalizeProvisional: vi.fn(),
    revokeProvisional: vi.fn()
  }
  const toolPermissionBroker = {
    approve: vi.fn(),
    cancel: vi.fn(),
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

  it('revokes an approved tool request when its grant does not reach dispatch', async () => {
    toolPermissionBroker.approve.mockReturnValueOnce(true)
    const port = createPort()

    const grant = await port.approvePermission('session-1', {
      permissionType: 'write',
      requestId: 'request-1'
    })

    expect(grant).toMatchObject({ kind: 'granted', lease: expect.any(Object) })
    if (grant.kind === 'granted') grant.lease?.revoke()
    expect(toolPermissionBroker.cancel).toHaveBeenCalledWith('request-1', 'session-1')
  })

  it('finalizes deferred filesystem paths only after dispatch commits', async () => {
    filePermissionService.approveProvisional.mockReturnValueOnce('file-lease-1')
    const port = createPort()

    const grant = await port.approvePermission('session-1', {
      permissionType: 'write',
      serverName: 'agent-filesystem',
      toolName: 'write',
      paths: ['/workspace/note.txt'],
      shellProfile: 'posix'
    })

    expect(filePermissionService.approveProvisional).toHaveBeenCalledWith(
      'session-1',
      ['/workspace/note.txt'],
      'write'
    )
    expect(grant).toMatchObject({
      kind: 'granted',
      lease: { capability: { kind: 'file', leaseId: 'file-lease-1' } }
    })
    if (grant.kind === 'granted') grant.lease?.finalize()
    expect(filePermissionService.finalizeProvisional).toHaveBeenCalledWith(
      'session-1',
      'file-lease-1'
    )
    expect(filePermissionService.revokeProvisional).not.toHaveBeenCalled()
    expect(commandPermissionService.approve).not.toHaveBeenCalled()
  })

  it('revokes a deferred settings approval that does not reach dispatch', async () => {
    settingsPermissionService.approveProvisional.mockReturnValueOnce('settings-lease-1')
    const port = createPort()

    const grant = await port.approvePermission('session-1', {
      permissionType: 'write',
      serverName: 'deepchat-settings',
      toolName: 'set_language'
    })

    expect(settingsPermissionService.approveProvisional).toHaveBeenCalledWith(
      'session-1',
      'set_language'
    )
    expect(grant).toMatchObject({
      kind: 'granted',
      lease: { capability: { kind: 'settings', leaseId: 'settings-lease-1' } }
    })
    if (grant.kind === 'granted') grant.lease?.revoke()
    expect(settingsPermissionService.revokeProvisional).toHaveBeenCalledWith(
      'session-1',
      'settings-lease-1'
    )
    expect(settingsPermissionService.finalizeProvisional).not.toHaveBeenCalled()
    expect(commandPermissionService.approve).not.toHaveBeenCalled()
  })
})
