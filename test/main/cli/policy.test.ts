import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { defineRouteContract } from '@shared/contracts/contract'
import type { LocalControlEffect } from '@shared/contracts/localControl'
import type { CliRouteCaller } from '@/routes/routeRegistry'
import { CliRequestPolicy, type CliPolicyAuditRecord } from '@/cli/policy'
import type { CliMutationGuard } from '@/cli/mutationGuard'
import { getCliSurfaceEntry, type CliSurfaceEntry } from '@/cli/surface'

const testRoute = defineRouteContract({
  name: 'settings.testMutation',
  input: z.object({ secret: z.string().optional() }),
  output: z.object({ ok: z.boolean() })
})

const humanCaller: CliRouteCaller = {
  kind: 'cli',
  principal: 'human',
  connectionId: 'human-connection',
  scopes: ['settings:write']
}

const agentCaller: CliRouteCaller = {
  kind: 'cli',
  principal: 'agent',
  connectionId: 'agent-connection',
  tokenId: 'token-id-conversation-1',
  conversationId: 'conversation-1',
  expiresAt: Date.now() + 60_000,
  scopes: ['settings:write']
}

function entry(
  effect: LocalControlEffect,
  approval: 'never' | 'policy' = 'never',
  agentPolicy?: CliSurfaceEntry['agentPolicy']
) {
  return {
    contract: testRoute,
    effect,
    callers: ['human', 'agent'],
    scopes: ['settings:write'],
    transport: 'rpc',
    approval,
    ...(agentPolicy ? { agentPolicy } : {}),
    auditProjection: () => ({ target: 'safe-setting' }),
    ...(approval === 'policy' ? { approvalDisplay: () => ({ target: 'safe-setting' }) } : {}),
    limits: { maxBodyBytes: 1024, timeoutMs: 5_000 }
  } satisfies CliSurfaceEntry
}

function createHarness(
  options: {
    allowlisted?: boolean
    agentComputeLimit?: number
    agentComputeStartsPerMinute?: number
    audit?: (record: CliPolicyAuditRecord) => void | Promise<void>
  } = {}
) {
  const auditRecords: CliPolicyAuditRecord[] = []
  const authorize = vi.fn(async () => ({ approvalRequestId: 'approval-request-1234' }))
  const mutationGuard = { authorize } as unknown as CliMutationGuard
  const policy = new CliRequestPolicy({
    mutationGuard,
    audit: options.audit ?? ((record) => auditRecords.push(record)),
    agentComputeLimit: options.agentComputeLimit,
    agentComputeStartsPerMinute: options.agentComputeStartsPerMinute
  })
  const invoke = (
    effect: LocalControlEffect,
    caller: CliRouteCaller,
    approval: 'never' | 'policy' = 'never'
  ) =>
    policy.authorize({
      entry: entry(effect, approval, options.allowlisted ? 'approval' : undefined),
      input: { secret: 'must-not-appear-in-audit' },
      caller,
      requestId: 'request-1',
      signal: new AbortController().signal
    })

  return { auditRecords, authorize, invoke, policy }
}

describe('CliRequestPolicy', () => {
  it.each(['read', 'compute', 'local-maintenance', 'preference-write'] as const)(
    'allows the human %s effect without approval',
    async (effect) => {
      const harness = createHarness()
      await expect(harness.invoke(effect, humanCaller)).resolves.toBeDefined()
      expect(harness.authorize).not.toHaveBeenCalled()
      expect(harness.auditRecords.at(-1)?.outcome).toBe('allowed')
    }
  )

  it.each([
    'security-config',
    'execution-config',
    'supply-chain',
    'credential',
    'destructive'
  ] as const)('requires renderer approval for the human %s effect', async (effect) => {
    const harness = createHarness()
    await expect(harness.invoke(effect, humanCaller, 'policy')).resolves.toBeDefined()
    expect(harness.authorize).toHaveBeenCalledOnce()
    expect(harness.auditRecords.at(-1)).toMatchObject({
      outcome: 'approved',
      approvalRequestId: 'approval-request-1234'
    })
  })

  it('denies agent maintenance and destructive effects', async () => {
    const harness = createHarness()
    await expect(harness.invoke('local-maintenance', agentCaller)).rejects.toMatchObject({
      code: 'permission_denied'
    })
    await expect(harness.invoke('destructive', agentCaller, 'policy')).rejects.toMatchObject({
      code: 'permission_denied'
    })
    expect(harness.authorize).not.toHaveBeenCalled()
    expect(harness.auditRecords.map((record) => record.outcome)).toEqual(['denied', 'denied'])
  })

  it('allows only explicitly opted-in Agent maintenance operations', async () => {
    const harness = createHarness()

    await expect(
      harness.policy.authorize({
        entry: entry('local-maintenance', 'never', 'allow'),
        input: {},
        caller: agentCaller,
        requestId: 'request-agent-maintenance',
        signal: new AbortController().signal
      })
    ).resolves.toBeDefined()
    expect(harness.authorize).not.toHaveBeenCalled()
    expect(harness.auditRecords.at(-1)?.outcome).toBe('allowed')
  })

  it('requires an explicit operation allowlist before an agent may request approval', async () => {
    const denied = createHarness()
    await expect(denied.invoke('supply-chain', agentCaller, 'policy')).rejects.toMatchObject({
      code: 'permission_denied'
    })

    const allowed = createHarness({ allowlisted: true })
    await expect(allowed.invoke('supply-chain', agentCaller, 'policy')).resolves.toBeDefined()
    expect(allowed.authorize).toHaveBeenCalledOnce()
    await expect(allowed.invoke('execution-config', agentCaller, 'policy')).rejects.toMatchObject({
      code: 'permission_denied'
    })
    await expect(allowed.invoke('credential', agentCaller, 'policy')).rejects.toMatchObject({
      code: 'permission_denied'
    })
    expect(allowed.authorize).toHaveBeenCalledOnce()
  })

  it('applies concrete Agent surface policies without widening denied effects', async () => {
    const harness = createHarness()
    const authorize = (input: {
      entry: CliSurfaceEntry
      params: unknown
      caller: CliRouteCaller
      requestId: string
    }) =>
      harness.policy.authorize({
        entry: input.entry,
        input: input.params,
        caller: input.caller,
        requestId: input.requestId,
        signal: new AbortController().signal
      })
    const settingEntry = getCliSurfaceEntry('settings.updatePublic')!

    await expect(
      authorize({
        entry: settingEntry,
        params: { changes: [{ key: 'fontSizeLevel', value: 3 }] },
        caller: agentCaller,
        requestId: 'request-setting-preference'
      })
    ).resolves.toBeDefined()
    await expect(
      authorize({
        entry: settingEntry,
        params: { changes: [{ key: 'loggingEnabled', value: true }] },
        caller: agentCaller,
        requestId: 'request-setting-security'
      })
    ).rejects.toMatchObject({ code: 'permission_denied' })

    const mcpCaller: CliRouteCaller = { ...agentCaller, scopes: ['mcp:write'] }
    const mcpEntry = getCliSurfaceEntry('mcp.addPublic')!
    await expect(
      authorize({
        entry: mcpEntry,
        params: {
          serverName: 'safe-server',
          config: {
            type: 'http',
            description: '',
            icon: '',
            baseUrl: 'https://mcp.example/api',
            headers: {}
          }
        },
        caller: mcpCaller,
        requestId: 'request-mcp-supply-chain'
      })
    ).resolves.toBeDefined()
    await expect(
      authorize({
        entry: mcpEntry,
        params: {
          serverName: 'credential-server',
          config: {
            type: 'http',
            baseUrl: 'https://mcp.example/api',
            headers: { Authorization: 'Bearer secret' }
          }
        },
        caller: mcpCaller,
        requestId: 'request-mcp-credential'
      })
    ).rejects.toMatchObject({ code: 'permission_denied' })

    await expect(
      authorize({
        entry: getCliSurfaceEntry('mcp.updatePublic')!,
        params: { serverName: 'safe-server', updates: { description: 'renamed' } },
        caller: mcpCaller,
        requestId: 'request-mcp-update'
      })
    ).rejects.toMatchObject({ code: 'permission_denied' })

    const runCaller: CliRouteCaller = { ...agentCaller, scopes: ['runs:cancel'] }
    await expect(
      authorize({
        entry: getCliSurfaceEntry('runs.cancel')!,
        params: { runId: 'conversation-1' },
        caller: runCaller,
        requestId: 'request-run-cancel'
      })
    ).resolves.toBeDefined()
    expect(harness.authorize).toHaveBeenCalledTimes(2)
  })

  it('fails closed when an approval effect lacks approval surface metadata', async () => {
    const harness = createHarness()

    await expect(harness.invoke('credential', humanCaller)).rejects.toMatchObject({
      code: 'internal_error'
    })
    expect(harness.authorize).not.toHaveBeenCalled()
    expect(harness.auditRecords.at(-1)?.outcome).toBe('misconfigured')
  })

  it('resolves input-dependent effects and rejects undeclared resolver output', async () => {
    const harness = createHarness()
    const dynamicEntry = {
      ...entry('read', 'policy'),
      effect: {
        possible: ['preference-write', 'security-config'],
        resolve: (input: unknown) =>
          (input as { secure?: boolean }).secure ? 'security-config' : 'preference-write'
      }
    } satisfies CliSurfaceEntry

    await expect(
      harness.policy.authorize({
        entry: dynamicEntry,
        input: { secure: false },
        caller: humanCaller,
        requestId: 'request-preference',
        signal: new AbortController().signal
      })
    ).resolves.toBeDefined()
    expect(harness.authorize).not.toHaveBeenCalled()
    await expect(
      harness.policy.authorize({
        entry: dynamicEntry,
        input: { secure: true },
        caller: humanCaller,
        requestId: 'request-security',
        signal: new AbortController().signal
      })
    ).resolves.toBeDefined()
    expect(harness.authorize).toHaveBeenCalledOnce()
    expect(harness.auditRecords.map((record) => record.effect)).toEqual([
      'preference-write',
      'security-config'
    ])

    await expect(
      harness.policy.authorize({
        entry: {
          ...dynamicEntry,
          effect: { possible: ['read'], resolve: () => 'destructive' }
        },
        input: {},
        caller: humanCaller,
        requestId: 'request-invalid-effect',
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ code: 'internal_error' })
  })

  it('applies input-level agent restrictions before requesting approval', async () => {
    const harness = createHarness({ allowlisted: true })

    await expect(
      harness.policy.authorize({
        entry: { ...entry('preference-write', 'policy'), agentInputAllowed: () => false },
        input: {},
        caller: agentCaller,
        requestId: 'request-agent-input',
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ code: 'permission_denied' })
    expect(harness.authorize).not.toHaveBeenCalled()
    expect(harness.auditRecords.at(-1)?.outcome).toBe('denied')
  })

  it('fails closed when an input-level agent policy throws', async () => {
    const harness = createHarness({ allowlisted: true })

    await expect(
      harness.policy.authorize({
        entry: {
          ...entry('preference-write', 'policy'),
          agentInputAllowed: () => {
            throw new Error('broken policy')
          }
        },
        input: {},
        caller: agentCaller,
        requestId: 'request-agent-policy-error',
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ code: 'internal_error' })
    expect(harness.authorize).not.toHaveBeenCalled()
  })

  it('audits and denies callers or scopes excluded by the surface entry', async () => {
    const harness = createHarness()
    await expect(
      harness.policy.authorize({
        entry: { ...entry('read'), callers: ['human'] },
        input: {},
        caller: agentCaller,
        requestId: 'request-caller',
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ code: 'permission_denied' })
    await expect(
      harness.policy.authorize({
        entry: entry('read'),
        input: {},
        caller: { ...humanCaller, scopes: [] },
        requestId: 'request-scope',
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ code: 'permission_denied' })

    expect(harness.auditRecords.map((record) => record.outcome)).toEqual(['denied', 'denied'])
    expect(harness.authorize).not.toHaveBeenCalled()
  })

  it('keeps raw secrets and prompts out of the structured audit record', async () => {
    const harness = createHarness()
    await harness.invoke('read', humanCaller)

    expect(JSON.stringify(harness.auditRecords)).not.toContain('must-not-appear-in-audit')
    expect(harness.auditRecords[0].redactedArgumentsHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('binds upload metadata to mutation approval without exposing raw params', async () => {
    const harness = createHarness()
    const transportBinding = { size: 11, sha256: 'a'.repeat(64) }

    await harness.policy.authorize({
      entry: entry('supply-chain', 'policy'),
      input: { secret: 'must-be-bound' },
      transportBinding,
      caller: humanCaller,
      requestId: 'request-upload',
      signal: new AbortController().signal
    })

    expect(harness.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: { params: { secret: 'must-be-bound' }, transport: transportBinding },
        displayData: { request: { target: 'safe-setting' }, transport: transportBinding }
      })
    )
    expect(JSON.stringify(harness.auditRecords)).not.toContain('must-be-bound')
  })

  it('limits concurrent and burst agent compute per conversation and releases idempotently', async () => {
    const harness = createHarness({ agentComputeLimit: 1, agentComputeStartsPerMinute: 2 })
    const first = await harness.invoke('compute', agentCaller)
    await expect(harness.invoke('compute', agentCaller)).rejects.toMatchObject({
      code: 'rate_limited'
    })
    first.release()
    first.release()

    const second = await harness.invoke('compute', agentCaller)
    second.release()
    await expect(harness.invoke('compute', agentCaller)).rejects.toMatchObject({
      code: 'rate_limited'
    })
  })

  it('isolates Programmatic Tool execution from general Agent compute capacity', async () => {
    const harness = createHarness({ agentComputeLimit: 1, agentComputeStartsPerMinute: 2 })
    const general = await harness.invoke('compute', agentCaller)
    const programmaticEntry = {
      ...entry('compute'),
      programmaticOnly: true
    } satisfies CliSurfaceEntry
    const invokeProgrammatic = () =>
      harness.policy.authorize({
        entry: programmaticEntry,
        input: {},
        caller: agentCaller,
        requestId: 'request-programmatic-tool',
        signal: new AbortController().signal
      })

    const programmatic = await invokeProgrammatic()
    await expect(harness.invoke('compute', agentCaller)).rejects.toMatchObject({
      code: 'rate_limited'
    })
    await expect(invokeProgrammatic()).rejects.toMatchObject({ code: 'rate_limited' })

    general.release()
    programmatic.release()
    const nextGeneral = await harness.invoke('compute', agentCaller)
    const nextProgrammatic = await invokeProgrammatic()
    nextGeneral.release()
    nextProgrammatic.release()
  })

  it('fails closed and releases compute admission when the audit sink fails', async () => {
    let shouldFail = true
    const harness = createHarness({
      agentComputeLimit: 1,
      audit: async () => {
        if (shouldFail) throw new Error('audit unavailable')
      }
    })

    await expect(harness.invoke('compute', agentCaller)).rejects.toThrow('audit unavailable')
    shouldFail = false
    const admission = await harness.invoke('compute', agentCaller)
    admission.release()
  })
})
