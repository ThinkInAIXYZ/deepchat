import { describe, expect, it } from 'vitest'
import { DEEPCHAT_ROUTE_CATALOG } from '@shared/contracts/routes'
import {
  CLI_SURFACE_V2,
  CLI_SURFACE_V3,
  getCliSurfaceEntry,
  getCliSurfaceRegistry,
  listCliSurfaceCapabilities,
  resolveCliSurfaceEffect
} from '@/cli/surface'
import {
  LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION,
  LOCAL_CONTROL_PUBLIC_ROUTE_SURFACE_VERSION
} from '@shared/contracts/localControl'

const humanApprovalCaller = { principal: 'human' } as const
const agentApprovalCaller = { principal: 'agent' } as const

describe('CLI surfaces', () => {
  it('contains only explicit canonical route contracts', () => {
    const methods = Array.from(CLI_SURFACE_V2.keys()).sort()

    expect(methods).toEqual([
      'artifacts.delete',
      'artifacts.describe',
      'artifacts.read',
      'audio.transcribeArtifact',
      'audio.transcribeUpload',
      'cli.capabilities',
      'cli.doctor',
      'cli.status',
      'cli.version',
      'events.subscribe',
      'images.generate',
      'mcp.addPublic',
      'mcp.listPublic',
      'mcp.removePublic',
      'mcp.setPublicStatus',
      'mcp.startPublic',
      'mcp.stopPublic',
      'mcp.updatePublic',
      'models.getPublicConfig',
      'models.invoke',
      'models.listRuntime',
      'models.resetConfig',
      'models.setPublicConfig',
      'models.setStatus',
      'ocr.clearCache',
      'ocr.extractArtifact',
      'ocr.extractUpload',
      'ocr.getRuntimeStatus',
      'providers.addPublic',
      'providers.listPublic',
      'providers.remove',
      'providers.setCredential',
      'providers.testPublicConnection',
      'providers.updatePublic',
      'runs.cancel',
      'runs.get',
      'sessions.runDetached',
      'settings.getPublic',
      'settings.updatePublic',
      'skills.installPublicUrl',
      'skills.installUpload',
      'skills.listPublic',
      'skills.setPublicStatus',
      'skills.uninstallPublic',
      'speech.generate',
      'videos.generate'
    ])
    for (const [method, entry] of CLI_SURFACE_V2) {
      expect(entry.contract).toBe(
        DEEPCHAT_ROUTE_CATALOG[method as keyof typeof DEEPCHAT_ROUTE_CATALOG]
      )
    }
  })

  it('denies methods that are not explicitly listed', () => {
    expect(getCliSurfaceEntry('settings.getSnapshot')).toBeUndefined()
    expect(getCliSurfaceEntry('mcp.callTool')).toBeUndefined()
    expect(getCliSurfaceEntry('mcp.getServers')).toBeUndefined()
    expect(getCliSurfaceEntry('mcp.credentials.set')).toBeUndefined()
    expect(getCliSurfaceEntry('databaseSecurity.disable')).toBeUndefined()
    expect(getCliSurfaceEntry('approvals.resolve')).toBeUndefined()
  })

  it('keeps Programmatic routes in the exact-grant V3 surface only', () => {
    expect(getCliSurfaceRegistry(LOCAL_CONTROL_PUBLIC_ROUTE_SURFACE_VERSION)).toBe(CLI_SURFACE_V2)
    expect(getCliSurfaceRegistry(LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION)).toBe(
      CLI_SURFACE_V3
    )
    expect(CLI_SURFACE_V3).not.toBe(CLI_SURFACE_V2)
    expect([...CLI_SURFACE_V3.keys()].slice(0, CLI_SURFACE_V2.size)).toEqual([
      ...CLI_SURFACE_V2.keys()
    ])
    expect([...CLI_SURFACE_V3.keys()].slice(CLI_SURFACE_V2.size)).toEqual([
      'tool.search',
      'tool.describe',
      'tool.call',
      'tool.batch'
    ])
    for (const method of ['tool.search', 'tool.describe', 'tool.call', 'tool.batch']) {
      expect(getCliSurfaceEntry(method)).toBeUndefined()
      expect(
        getCliSurfaceEntry(method, LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION)
      ).toMatchObject({
        callers: ['agent'],
        scopes: [],
        transport: 'rpc',
        programmaticOnly: true
      })
    }
  })

  it('keeps Agent mutation policy as an explicit operation opt-in', () => {
    const policies = Array.from(CLI_SURFACE_V3, ([method, entry]) => ({ method, entry })).filter(
      ({ entry }) => entry.agentPolicy !== undefined
    )

    expect(
      policies
        .filter(({ entry }) => entry.agentPolicy === 'approval')
        .map(({ method }) => method)
        .sort()
    ).toEqual(['mcp.addPublic', 'settings.updatePublic', 'skills.installPublicUrl'])
    expect(
      policies.filter(({ entry }) => entry.agentPolicy === 'allow').map(({ method }) => method)
    ).toEqual(['runs.cancel'])
    for (const { entry } of policies) {
      expect(entry.callers).toContain('agent')
      if (entry.agentPolicy === 'approval') expect(entry.approval).toBe('policy')
    }
  })

  it('classifies public setting changes from their validated key', () => {
    const entry = getCliSurfaceEntry('settings.updatePublic')!

    expect(
      resolveCliSurfaceEffect(entry, {
        changes: [{ key: 'fontSizeLevel', value: 3 }]
      })
    ).toBe('preference-write')
    expect(
      resolveCliSurfaceEffect(entry, {
        changes: [{ key: 'loggingEnabled', value: true }]
      })
    ).toBe('security-config')
    expect(
      resolveCliSurfaceEffect(entry, {
        changes: [{ key: 'ocrBackend', value: 'cpu' }]
      })
    ).toBe('execution-config')
    expect(
      entry.agentInputAllowed?.({ changes: [{ key: 'privacyModeEnabled', value: true }] })
    ).toBe(false)
    expect(
      entry.approvalDisplay?.(
        { changes: [{ key: 'privacyModeEnabled', value: true }] },
        humanApprovalCaller
      )
    ).toEqual({ changes: [{ key: 'privacyModeEnabled', value: true }] })
  })

  it('never projects provider credential material into approval or audit metadata', () => {
    const entry = getCliSurfaceEntry('providers.setCredential')!
    const input = {
      providerId: 'provider-1',
      action: 'set',
      kind: 'api-key',
      value: 'super-secret'
    }

    expect(entry.auditProjection?.(input)).toEqual({
      providerId: 'provider-1',
      action: 'set',
      kind: 'api-key'
    })
    expect(entry.approvalDisplay?.(input, humanApprovalCaller)).toEqual({
      providerId: 'provider-1',
      action: 'set',
      kind: 'api-key'
    })
    expect(JSON.stringify(entry.approvalDisplay?.(input, humanApprovalCaller))).not.toContain(
      'super-secret'
    )
  })

  it('shows safe mutation values in approvals while keeping audits structural', () => {
    const providerEntry = getCliSurfaceEntry('providers.updatePublic')!
    const providerInput = {
      providerId: 'provider-1',
      updates: { baseUrl: 'https://api.example/v1', enabled: false }
    }
    expect(providerEntry.auditProjection?.(providerInput)).toEqual({
      providerId: 'provider-1',
      fields: ['baseUrl', 'enabled']
    })
    expect(providerEntry.approvalDisplay?.(providerInput, humanApprovalCaller)).toEqual(
      providerInput
    )

    const modelEntry = getCliSurfaceEntry('models.setPublicConfig')!
    const modelInput = {
      providerId: 'provider-1',
      modelId: 'model-1',
      config: { maxTokens: 4096, contextLength: 32768 }
    }
    expect(modelEntry.approvalDisplay?.(modelInput, humanApprovalCaller)).toEqual(modelInput)
  })

  it('keeps signed Skill URL secrets out of approval and audit projections', () => {
    const entry = getCliSurfaceEntry('skills.installPublicUrl')!
    const input = {
      agentId: 'deepchat',
      url: 'https://skills.example/archive.zip?signature=private-token',
      overwrite: true
    }

    expect(entry.approvalDisplay?.(input, humanApprovalCaller)).toEqual({
      agentId: 'deepchat',
      overwrite: true,
      origin: 'https://skills.example',
      path: '/archive.zip',
      queryPresent: true
    })
    expect(JSON.stringify(entry.auditProjection?.(input))).not.toContain('private-token')
    expect(entry.agentInputAllowed?.(input)).toBe(false)
    expect(
      entry.agentInputAllowed?.({
        ...input,
        url: 'https://skills.example/archive.zip'
      })
    ).toBe(true)
    expect(getCliSurfaceEntry('skills.setPublicStatus')?.limits.timeoutMs).toBeGreaterThanOrEqual(
      2 * 60_000
    )
    expect(getCliSurfaceEntry('skills.uninstallPublic')?.limits.timeoutMs).toBeGreaterThanOrEqual(
      2 * 60_000
    )
  })

  it('keeps MCP secret values and command arguments out of bounded metadata', () => {
    const entry = getCliSurfaceEntry('mcp.addPublic')!
    const input = {
      serverName: 'private-server',
      config: {
        type: 'http',
        baseUrl: 'https://mcp.example/private/path',
        description: 'description'.repeat(2_000),
        args: ['--token', 'argument-secret'],
        environment: { PRIVATE_TOKEN: 'environment-secret' },
        headers: { Authorization: 'header-secret' },
        authorization: {
          mode: 'client_credentials',
          clientId: 'private-client-id'
        }
      }
    }

    const approval = entry.approvalDisplay?.(input, humanApprovalCaller)
    const audit = entry.auditProjection?.(input)
    const serialized = JSON.stringify({ approval, audit })
    expect(approval).toMatchObject({
      serverName: 'private-server',
      config: {
        type: 'http',
        argumentCount: 2,
        endpoint: { origin: 'https://mcp.example', pathPresent: true },
        environment: { count: 1, names: ['PRIVATE_TOKEN'] },
        headers: { count: 1, names: ['Authorization'] },
        authorization: { mode: 'client_credentials' }
      }
    })
    for (const secret of [
      'argument-secret',
      'environment-secret',
      'header-secret',
      'private-client-id',
      '/private/path'
    ]) {
      expect(serialized).not.toContain(secret)
    }
    expect(Buffer.byteLength(JSON.stringify(approval), 'utf8')).toBeLessThan(16 * 1024)
    expect(resolveCliSurfaceEffect(entry, input)).toBe('credential')
    expect(
      resolveCliSurfaceEffect(entry, {
        serverName: 'public-server',
        config: { type: 'stdio', command: 'npx', environment: {} }
      })
    ).toBe('supply-chain')
    expect(
      resolveCliSurfaceEffect(entry, {
        serverName: 'authorized-server',
        config: {
          type: 'http',
          baseUrl: 'https://mcp.example/api',
          headers: {},
          authorization: { mode: 'interactive' }
        }
      })
    ).toBe('security-config')
  })

  it('limits Agent MCP additions to disabled reviewable remote configurations', () => {
    const entry = getCliSurfaceEntry('mcp.addPublic')!
    const input = {
      serverName: 'reviewable-server',
      config: {
        type: 'http',
        description: 'Reviewable\0remote\u0085server',
        icon: 'cloud',
        baseUrl: 'https://mcp.example/api',
        headers: {}
      }
    }

    expect(entry.agentInputAllowed?.(input)).toBe(true)
    expect(entry.approvalDisplay?.(input, agentApprovalCaller)).toMatchObject({
      serverName: 'reviewable-server',
      config: {
        description: 'Reviewableremoteserver',
        descriptionTruncated: false,
        icon: 'cloud',
        endpointUrl: 'https://mcp.example/api'
      }
    })
    expect(entry.auditProjection?.(input)).not.toEqual(
      expect.objectContaining({ command: expect.anything(), arguments: expect.anything() })
    )

    expect(
      entry.agentInputAllowed?.({
        ...input,
        config: { ...input.config, headers: { Authorization: 'secret' } }
      })
    ).toBe(false)
    expect(
      entry.agentInputAllowed?.({
        serverName: 'stdio-server',
        config: {
          type: 'stdio',
          command: 'npx',
          args: ['@example/mcp-server'],
          environment: {},
          inheritEnv: 'minimal'
        }
      })
    ).toBe(false)
    expect(
      entry.agentInputAllowed?.({
        serverName: 'authorized-server',
        config: {
          type: 'http',
          baseUrl: 'https://mcp.example/api',
          headers: {},
          authorization: { mode: 'interactive' }
        }
      })
    ).toBe(false)
    expect(
      entry.agentInputAllowed?.({
        ...input,
        config: { ...input.config, description: 'x'.repeat(16 * 1024) }
      })
    ).toBe(false)
    expect(getCliSurfaceEntry('mcp.updatePublic')?.callers).toEqual(['human'])
  })

  it('gives every approval route enough server time for renderer confirmation', () => {
    for (const capability of listCliSurfaceCapabilities()) {
      if (capability.approval !== 'policy') continue
      expect(capability.timeoutMs, capability.method).toBeGreaterThanOrEqual(2 * 60_000)
    }
  })

  it('classifies MCP updates by their highest-impact field', () => {
    const entry = getCliSurfaceEntry('mcp.updatePublic')!

    expect(resolveCliSurfaceEffect(entry, { updates: { description: 'renamed' } })).toBe(
      'execution-config'
    )
    expect(resolveCliSurfaceEffect(entry, { updates: { authorization: null } })).toBe(
      'security-config'
    )
    expect(resolveCliSurfaceEffect(entry, { updates: { command: 'npx' } })).toBe('supply-chain')
    expect(resolveCliSurfaceEffect(entry, { updates: { headers: {} } })).toBe('credential')
  })

  it('publishes stable sorted capability metadata', () => {
    expect(listCliSurfaceCapabilities()).toEqual([
      expect.objectContaining({
        method: 'artifacts.delete',
        possibleEffects: ['local-maintenance']
      }),
      expect.objectContaining({ method: 'artifacts.describe', possibleEffects: ['read'] }),
      expect.objectContaining({
        method: 'artifacts.read',
        possibleEffects: ['read'],
        transport: 'download'
      }),
      expect.objectContaining({
        method: 'audio.transcribeArtifact',
        possibleEffects: ['compute'],
        transport: 'rpc',
        callers: ['human', 'agent'],
        scopes: ['audio:transcribe', 'artifacts:read']
      }),
      expect.objectContaining({
        method: 'audio.transcribeUpload',
        possibleEffects: ['compute'],
        transport: 'upload',
        callers: ['human']
      }),
      expect.objectContaining({ method: 'cli.capabilities', possibleEffects: ['read'] }),
      expect.objectContaining({ method: 'cli.doctor', possibleEffects: ['read'] }),
      expect.objectContaining({ method: 'cli.status', possibleEffects: ['read'] }),
      expect.objectContaining({ method: 'cli.version', possibleEffects: ['read'] }),
      expect.objectContaining({
        method: 'events.subscribe',
        possibleEffects: ['read'],
        transport: 'stream',
        callers: ['human'],
        scopes: ['runs:read']
      }),
      expect.objectContaining({
        method: 'images.generate',
        possibleEffects: ['compute'],
        transport: 'stream'
      }),
      expect.objectContaining({
        method: 'mcp.addPublic',
        possibleEffects: ['security-config', 'supply-chain', 'credential'],
        callers: ['human', 'agent'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'mcp.listPublic',
        possibleEffects: ['read'],
        callers: ['human', 'agent']
      }),
      expect.objectContaining({
        method: 'mcp.removePublic',
        possibleEffects: ['destructive'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'mcp.setPublicStatus',
        possibleEffects: ['execution-config'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'mcp.startPublic',
        possibleEffects: ['execution-config'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'mcp.stopPublic',
        possibleEffects: ['execution-config'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'mcp.updatePublic',
        possibleEffects: ['execution-config', 'security-config', 'supply-chain', 'credential'],
        callers: ['human'],
        approval: 'policy'
      }),
      expect.objectContaining({ method: 'models.getPublicConfig', possibleEffects: ['read'] }),
      expect.objectContaining({
        method: 'models.invoke',
        possibleEffects: ['compute'],
        transport: 'stream'
      }),
      expect.objectContaining({ method: 'models.listRuntime', possibleEffects: ['read'] }),
      expect.objectContaining({
        method: 'models.resetConfig',
        possibleEffects: ['execution-config'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'models.setPublicConfig',
        possibleEffects: ['execution-config'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'models.setStatus',
        possibleEffects: ['execution-config'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'ocr.clearCache',
        possibleEffects: ['local-maintenance'],
        approval: 'never',
        callers: ['human']
      }),
      expect.objectContaining({
        method: 'ocr.extractArtifact',
        possibleEffects: ['compute'],
        transport: 'rpc',
        callers: ['human', 'agent'],
        scopes: ['ocr:extract', 'artifacts:read']
      }),
      expect.objectContaining({
        method: 'ocr.extractUpload',
        possibleEffects: ['compute'],
        transport: 'upload',
        callers: ['human']
      }),
      expect.objectContaining({ method: 'ocr.getRuntimeStatus', possibleEffects: ['read'] }),
      expect.objectContaining({
        method: 'providers.addPublic',
        possibleEffects: ['execution-config'],
        approval: 'policy'
      }),
      expect.objectContaining({ method: 'providers.listPublic', possibleEffects: ['read'] }),
      expect.objectContaining({
        method: 'providers.remove',
        possibleEffects: ['destructive'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'providers.setCredential',
        possibleEffects: ['credential'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'providers.testPublicConnection',
        possibleEffects: ['compute'],
        approval: 'never'
      }),
      expect.objectContaining({
        method: 'providers.updatePublic',
        possibleEffects: ['execution-config'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'runs.cancel',
        possibleEffects: ['local-maintenance'],
        callers: ['human', 'agent'],
        scopes: ['runs:cancel']
      }),
      expect.objectContaining({
        method: 'runs.get',
        possibleEffects: ['read'],
        callers: ['human', 'agent'],
        scopes: ['runs:read']
      }),
      expect.objectContaining({
        method: 'sessions.runDetached',
        possibleEffects: ['compute'],
        callers: ['human'],
        scopes: ['sessions:run']
      }),
      expect.objectContaining({ method: 'settings.getPublic', possibleEffects: ['read'] }),
      expect.objectContaining({
        method: 'settings.updatePublic',
        possibleEffects: ['preference-write', 'execution-config', 'security-config'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'skills.installPublicUrl',
        possibleEffects: ['supply-chain'],
        callers: ['human', 'agent'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'skills.installUpload',
        possibleEffects: ['supply-chain'],
        callers: ['human'],
        transport: 'upload',
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'skills.listPublic',
        possibleEffects: ['read'],
        callers: ['human', 'agent']
      }),
      expect.objectContaining({
        method: 'skills.setPublicStatus',
        possibleEffects: ['execution-config'],
        callers: ['human'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'skills.uninstallPublic',
        possibleEffects: ['destructive'],
        callers: ['human'],
        approval: 'policy'
      }),
      expect.objectContaining({
        method: 'speech.generate',
        possibleEffects: ['compute'],
        transport: 'stream'
      }),
      expect.objectContaining({
        method: 'videos.generate',
        possibleEffects: ['compute'],
        transport: 'stream'
      })
    ])
    expect(
      listCliSurfaceCapabilities()
        .filter((capability) => capability.approval === 'policy')
        .map((capability) => capability.method)
    ).toEqual([
      'mcp.addPublic',
      'mcp.removePublic',
      'mcp.setPublicStatus',
      'mcp.startPublic',
      'mcp.stopPublic',
      'mcp.updatePublic',
      'models.resetConfig',
      'models.setPublicConfig',
      'models.setStatus',
      'providers.addPublic',
      'providers.remove',
      'providers.setCredential',
      'providers.updatePublic',
      'settings.updatePublic',
      'skills.installPublicUrl',
      'skills.installUpload',
      'skills.setPublicStatus',
      'skills.uninstallPublic'
    ])
  })
})
