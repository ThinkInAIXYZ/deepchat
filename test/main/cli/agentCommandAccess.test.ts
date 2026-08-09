import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LOCAL_CONTROL_AGENT_TOKEN_ENV } from '@shared/contracts/localControl'
import { AgentCliCommandAccess, resolveBundledCliDirectory } from '@/cli/agentCommandAccess'
import { AgentCliTokenAuthority } from '@/cli/agentTokenAuthority'
import { CommandPermissionService } from '@/tool/permission/commandPermissionService'
import {
  CMD_COMMAND_SHELL,
  POSIX_COMMAND_SHELL,
  WINDOWS_POWERSHELL_COMMAND_SHELL
} from '../../helpers/commandShell'

const temporaryDirectories: string[] = []

const createEnvironment = (
  access: AgentCliCommandAccess,
  conversationId: string,
  command: string
) => access.createEnvironment(conversationId, command, POSIX_COMMAND_SHELL)

async function createCliDirectory(platform: NodeJS.Platform = 'darwin') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'deepchat-agent-cli-'))
  temporaryDirectories.push(root)
  const directory = path.join(root, 'out', 'cli')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, platform === 'win32' ? 'deepchat.cmd' : 'deepchat'), '')
  return { root, directory }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('AgentCliCommandAccess', () => {
  it('issues one scoped call only for a standalone two-token CLI command', async () => {
    const { directory } = await createCliDirectory()
    const agentToken = 'a'.repeat(43)
    const authority = new AgentCliTokenAuthority({
      now: () => 1_000,
      createToken: () => agentToken,
      createTokenId: () => 'token-id-conversation-1'
    })
    const access = new AgentCliCommandAccess({
      tokenAuthority: authority,
      commandPermission: new CommandPermissionService(),
      resolveCliDirectory: () => directory
    })

    const environment = createEnvironment(
      access,
      ' conversation-1 ',
      'deepchat model invoke --prompt hello --jsonl'
    )

    expect(environment).toEqual({
      variables: { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: agentToken },
      prependPath: [directory],
      preserveCommand: true
    })
    const first = authority.beginRequest(agentToken)
    expect(first.status).toBe('granted')
    if (first.status !== 'granted') throw new Error('Expected Agent CLI grant')
    expect(first.grant.claims).toMatchObject({
      conversationId: 'conversation-1',
      expiresAt: 301_000,
      scopes: ['models:invoke']
    })
    first.grant.release()
    expect(authority.beginRequest(agentToken)).toEqual({ status: 'quota-exhausted' })
  })

  it.each([
    'deepchat --json model invoke',
    'deepchat model',
    'deepchat run watch --run conversation-1',
    'deepchat provider remove --provider provider-1',
    'deepchat unknown command',
    'deepchat model invoke > output.txt',
    'deepchat model invoke | tee output.txt',
    'FOO=bar deepchat model invoke',
    `deepchat model invoke --prompt $${LOCAL_CONTROL_AGENT_TOKEN_ENV}`
  ])('blocks human-token fallback without issuing authority for %j', async (command) => {
    const { directory } = await createCliDirectory()
    const authority = new AgentCliTokenAuthority()
    const access = new AgentCliCommandAccess({
      tokenAuthority: authority,
      commandPermission: new CommandPermissionService(),
      resolveCliDirectory: () => directory
    })

    expect(createEnvironment(access, 'conversation-1', command)).toEqual({
      variables: { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: '' },
      prependPath: [],
      preserveCommand: true
    })
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })

  it('blocks case-insensitive token references under Windows PowerShell', async () => {
    const { directory } = await createCliDirectory('win32')
    const authority = new AgentCliTokenAuthority()
    const access = new AgentCliCommandAccess({
      tokenAuthority: authority,
      commandPermission: new CommandPermissionService(),
      resolveCliDirectory: () => directory
    })

    expect(
      access.createEnvironment(
        'conversation-1',
        'deepchat model invoke --prompt $env:deepchat_cli_agent_token',
        WINDOWS_POWERSHELL_COMMAND_SHELL
      )
    ).toEqual({
      variables: { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: '' },
      prependPath: [],
      preserveCommand: true
    })
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })

  it('does not issue a scoped token for CMD caret syntax', async () => {
    const { directory } = await createCliDirectory('win32')
    const authority = new AgentCliTokenAuthority()
    const access = new AgentCliCommandAccess({
      tokenAuthority: authority,
      commandPermission: new CommandPermissionService(),
      resolveCliDirectory: () => directory
    })

    expect(
      access.createEnvironment(
        'conversation-1',
        'deepchat model invoke ^" & whoami"',
        CMD_COMMAND_SHELL
      )
    ).toEqual({
      variables: { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: '' },
      prependPath: [],
      preserveCommand: true
    })
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })

  it('blocks case-insensitive CMD token expansion without issuing authority', async () => {
    const { directory } = await createCliDirectory('win32')
    const authority = new AgentCliTokenAuthority()
    const access = new AgentCliCommandAccess({
      tokenAuthority: authority,
      commandPermission: new CommandPermissionService(),
      resolveCliDirectory: () => directory
    })

    expect(
      access.createEnvironment(
        'conversation-1',
        'deepchat model invoke --prompt %deepchat_cli_agent_token%',
        CMD_COMMAND_SHELL
      )
    ).toEqual({
      variables: { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: '' },
      prependPath: [],
      preserveCommand: true
    })
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })

  it('marks non-CLI commands as unprivileged without suppressing command rewriting', async () => {
    const { directory } = await createCliDirectory()
    const authority = new AgentCliTokenAuthority()
    const access = new AgentCliCommandAccess({
      tokenAuthority: authority,
      commandPermission: new CommandPermissionService(),
      resolveCliDirectory: () => directory
    })

    expect(createEnvironment(access, 'conversation-1', 'ls -la')).toEqual({
      variables: { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: '' },
      prependPath: [],
      preserveCommand: false
    })
    expect(createEnvironment(access, 'conversation-1', '"deepchat" model invoke')).toEqual({
      variables: { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: '' },
      prependPath: [],
      preserveCommand: false
    })
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })

  it('resolves local help through the bundled launcher without granting authority', async () => {
    const { directory } = await createCliDirectory()
    const authority = new AgentCliTokenAuthority()
    const access = new AgentCliCommandAccess({
      tokenAuthority: authority,
      commandPermission: new CommandPermissionService(),
      resolveCliDirectory: () => directory
    })

    expect(createEnvironment(access, 'conversation-1', 'deepchat help')).toEqual({
      variables: { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: '' },
      prependPath: [directory],
      preserveCommand: true
    })
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })

  it('derives dynamic artifact command scopes from the Agent surface', async () => {
    const { directory } = await createCliDirectory()
    const agentToken = 'b'.repeat(43)
    const authority = new AgentCliTokenAuthority({
      createToken: () => agentToken,
      createTokenId: () => 'token-id-conversation-1'
    })
    const access = new AgentCliCommandAccess({
      tokenAuthority: authority,
      commandPermission: new CommandPermissionService(),
      resolveCliDirectory: () => directory
    })

    expect(
      createEnvironment(
        access,
        'conversation-1',
        'deepchat audio transcribe --artifact artifact-1 --provider p --model m'
      )
    ).toMatchObject({ variables: { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: agentToken } })
    const request = authority.beginRequest(agentToken)
    expect(request.status).toBe('granted')
    if (request.status !== 'granted') throw new Error('Expected Agent CLI grant')
    expect(request.grant.claims.scopes).toEqual(['audio:transcribe', 'artifacts:read'])
    request.grant.release()
  })

  it('fails closed without a built launcher', () => {
    const authority = new AgentCliTokenAuthority()
    const access = new AgentCliCommandAccess({
      tokenAuthority: authority,
      commandPermission: new CommandPermissionService(),
      resolveCliDirectory: () => null
    })

    expect(createEnvironment(access, 'conversation-1', 'deepchat system status')).toEqual({
      variables: { [LOCAL_CONTROL_AGENT_TOKEN_ENV]: '' },
      prependPath: [],
      preserveCommand: true
    })
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })
})

describe('resolveBundledCliDirectory', () => {
  it('finds development and packaged launchers without guessing a missing path', async () => {
    const development = await createCliDirectory()
    expect(
      resolveBundledCliDirectory({
        appPath: development.root,
        resourcesPath: '/unused',
        isPackaged: false,
        platform: 'darwin',
        isFile: (filePath) => filePath === path.join(development.directory, 'deepchat')
      })
    ).toBe(development.directory)

    const packagedRoot = await mkdtemp(path.join(os.tmpdir(), 'deepchat-packaged-cli-'))
    temporaryDirectories.push(packagedRoot)
    const packagedDirectory = path.join(packagedRoot, 'app.asar.unpacked', 'cli')
    await mkdir(packagedDirectory, { recursive: true })
    await writeFile(path.join(packagedDirectory, 'deepchat.cmd'), '')
    expect(
      resolveBundledCliDirectory({
        appPath: '/unused',
        resourcesPath: packagedRoot,
        isPackaged: true,
        platform: 'win32',
        isFile: (filePath) => filePath === path.join(packagedDirectory, 'deepchat.cmd')
      })
    ).toBe(packagedDirectory)
    expect(
      resolveBundledCliDirectory({
        appPath: '/missing',
        resourcesPath: '/missing',
        isPackaged: false,
        platform: 'linux',
        isFile: () => false
      })
    ).toBeNull()
  })
})
