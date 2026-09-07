import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION,
  AgentCliTokenAuthority,
  type AgentCliProgrammaticOperationBinding
} from '@/cli/agentTokenAuthority'
import { ProgrammaticToolParentController } from '@/cli/programmaticToolParentController'
import {
  ProgrammaticToolParentRegistry,
  assertIssuedProgrammaticToolAuthorityAssertion
} from '@/cli/programmaticToolParentRegistry'
import { LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION } from '@shared/contracts/localControl'
import { ExecutionJournalService } from '@/tape/application/executionJournalService'
import { createTapeTableMock } from '../session/data/tapeTestHarness'
import type { ProgrammaticToolCapabilityV1 } from '@/agent/deepchat/runtime/programmaticToolSurface'
import type { ToolSurfaceSnapshot } from '@/agent/deepchat/runtime/toolSurface'

const RUN_ID = '22222222-2222-4222-8222-222222222222'
const RUN = { sessionId: 'session-1', runId: RUN_ID }

function binding(): AgentCliProgrammaticOperationBinding {
  return {
    schemaVersion: AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION,
    surfaceVersion: LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION,
    operation: {
      sessionId: 'session-1',
      messageId: 'assistant-1',
      runId: RUN_ID,
      requestSeq: 1,
      providerToolCallId: 'exec-call-1'
    },
    command: { domain: 'tool', verb: 'call' },
    route: 'tool.call',
    canonicalInvocationHash: '1'.repeat(64),
    adapterMode: 'cli-programmatic',
    capabilityHash: '2'.repeat(64),
    programmaticSurfaceHash: '3'.repeat(64),
    quotas: {
      maxChildren: 4,
      maxBatchSteps: 4,
      maxInputBytes: 4_096,
      maxOutputBytes: 8_192,
      maxDurationMs: 30_000
    }
  }
}

function setup() {
  const operationBinding = binding()
  const { entries, table } = createTapeTableMock()
  const journal = new ExecutionJournalService(() => table)
  const authority = new AgentCliTokenAuthority({
    createToken: () => 'p'.repeat(43),
    createTokenId: () => 'programmatic-token-1'
  })
  const prepared = authority.prepareProgrammaticOperation({
    binding: operationBinding,
    assertAuthorityActive: () => undefined
  })
  const controller = new ProgrammaticToolParentController(prepared, journal)
  const registry = new ProgrammaticToolParentRegistry()
  const registration = registry.register(controller)
  journal.commitRunStarted({
    sessionId: operationBinding.operation.sessionId,
    runId: operationBinding.operation.runId,
    messageId: operationBinding.operation.messageId,
    runKind: 'loop'
  })
  return { authority, controller, entries, journal, operationBinding, registration, registry }
}

describe('ProgrammaticToolParentRegistry', () => {
  it('resolves only the exact armed process-live invocation authority', () => {
    const operationBinding = binding()
    const { table } = createTapeTableMock()
    const journal = new ExecutionJournalService(() => table)
    const authority = new AgentCliTokenAuthority({
      createToken: () => 'v'.repeat(43),
      createTokenId: () => 'resolved-programmatic-token'
    })
    const registry = new ProgrammaticToolParentRegistry({
      tokenAuthority: authority,
      executionJournal: journal
    })
    const capability = {
      capabilityHash: operationBinding.capabilityHash,
      programmaticSurfaceHash: operationBinding.programmaticSurfaceHash
    } as ProgrammaticToolCapabilityV1
    const snapshot = {} as ToolSurfaceSnapshot
    let active = true
    const assertAuthorityActive = vi.fn(() => {
      if (!active) throw new Error('View revoked')
    })
    journal.commitRunStarted({
      sessionId: operationBinding.operation.sessionId,
      runId: operationBinding.operation.runId,
      messageId: operationBinding.operation.messageId,
      runKind: 'loop'
    })
    const registration = registry.prepare({
      binding: operationBinding,
      invocationAuthority: { capability, snapshot, permissionMode: 'default' },
      assertAuthorityActive
    })
    const outerDispatch = journal.commitDispatch({
      sessionId: operationBinding.operation.sessionId,
      messageId: operationBinding.operation.messageId,
      operation: {
        runId: operationBinding.operation.runId,
        requestSeq: operationBinding.operation.requestSeq,
        providerToolCallId: operationBinding.operation.providerToolCallId
      },
      toolName: 'exec',
      toolSource: 'agent',
      normalizedArguments: { command: 'deepchat tool call', stdin: '{}' },
      target: { serverName: 'agent-filesystem', originalName: 'exec' }
    })
    registration.armOuterDispatch({ ...outerDispatch, operation: operationBinding.operation })
    const grant = registration.takeArmedToken().programmaticOperation

    const invocation = registry.resolveInvocation(grant)
    expect(invocation).toMatchObject({
      capability,
      snapshot,
      permissionMode: 'default'
    })
    expect(() =>
      assertIssuedProgrammaticToolAuthorityAssertion(invocation.assertAuthorityActive)
    ).not.toThrow()
    expect(() => assertIssuedProgrammaticToolAuthorityAssertion(() => undefined)).toThrow(
      /was not issued by its parent registry/
    )
    expect(() => invocation.assertAuthorityActive()).not.toThrow()
    expect(assertAuthorityActive).toHaveBeenCalledTimes(4)
    expect(() => registry.resolveInvocation({ ...grant, capabilityHash: '9'.repeat(64) })).toThrow(
      /does not match its registered parent authority/
    )

    active = false
    expect(() => registry.resolveInvocation(grant)).toThrow('View revoked')
    const responseText = 'Tool is not available in the current session'
    registry.failToolInvocationBeforePlan(grant, { responseText, isError: true })
    expect(registration.takeCompletedInvocationResult()).toEqual({ responseText, isError: true })
    registration.settleOuterOutcome({ responseText, isError: true })
    expect(() => registry.resolveInvocation(grant)).toThrow(/authority is unavailable/)
  })

  it('prepares an inert grant and exposes it exactly once after the real outer T1', () => {
    const operationBinding = binding()
    const { table } = createTapeTableMock()
    const journal = new ExecutionJournalService(() => table)
    const authority = new AgentCliTokenAuthority({
      createToken: () => 'r'.repeat(43),
      createTokenId: () => 'prepared-programmatic-token'
    })
    const registry = new ProgrammaticToolParentRegistry({
      tokenAuthority: authority,
      executionJournal: journal
    })
    journal.commitRunStarted({
      sessionId: operationBinding.operation.sessionId,
      runId: operationBinding.operation.runId,
      messageId: operationBinding.operation.messageId,
      runKind: 'loop'
    })
    const registration = registry.prepare({
      binding: operationBinding,
      assertAuthorityActive: () => undefined
    })

    expect(authority.beginRequest('r'.repeat(43))).toEqual({ status: 'invalid' })
    expect(() => registration.takeArmedToken()).toThrow(/no armed invocation token/)
    const outerDispatch = journal.commitDispatch({
      sessionId: operationBinding.operation.sessionId,
      messageId: operationBinding.operation.messageId,
      operation: {
        runId: operationBinding.operation.runId,
        requestSeq: operationBinding.operation.requestSeq,
        providerToolCallId: operationBinding.operation.providerToolCallId
      },
      toolName: 'exec',
      toolSource: 'agent',
      normalizedArguments: { command: 'deepchat tool call', stdin: '{}' },
      target: { serverName: 'agent-filesystem', originalName: 'exec' }
    })
    registration.armOuterDispatch({
      ...outerDispatch,
      operation: operationBinding.operation
    })

    const armed = registration.takeArmedToken()
    expect(armed.token).toBe('r'.repeat(43))
    expect(() => registration.takeArmedToken()).toThrow(/no armed invocation token/)
    expect(
      registration.settleProcessFailure({ responseText: 'launcher unavailable' })
    ).toMatchObject({
      result: { responseText: 'launcher unavailable', isError: true },
      receipt: { created: true }
    })
    expect(authority.beginRequest(armed.token)).toEqual({ status: 'invalid' })
    expect(() => registry.assertRunTerminalAllowed(RUN)).not.toThrow()
  })

  it('hands one authoritative discovery result from local control to outer settlement', () => {
    const operationBinding = binding()
    const searchBinding: AgentCliProgrammaticOperationBinding = {
      ...operationBinding,
      command: { domain: 'tool', verb: 'search' },
      route: 'tool.search'
    }
    const { table, entries } = createTapeTableMock()
    const journal = new ExecutionJournalService(() => table)
    const authority = new AgentCliTokenAuthority({
      createToken: () => 'd'.repeat(43),
      createTokenId: () => 'discovery-programmatic-token'
    })
    const registry = new ProgrammaticToolParentRegistry({
      tokenAuthority: authority,
      executionJournal: journal
    })
    const capability = {
      capabilityHash: searchBinding.capabilityHash,
      programmaticSurfaceHash: searchBinding.programmaticSurfaceHash
    } as ProgrammaticToolCapabilityV1
    journal.commitRunStarted({
      sessionId: searchBinding.operation.sessionId,
      runId: searchBinding.operation.runId,
      messageId: searchBinding.operation.messageId,
      runKind: 'loop'
    })
    const registration = registry.prepare({
      binding: searchBinding,
      invocationAuthority: {
        capability,
        snapshot: {} as ToolSurfaceSnapshot,
        permissionMode: 'default'
      },
      assertAuthorityActive: () => undefined
    })
    const outerDispatch = journal.commitDispatch({
      sessionId: searchBinding.operation.sessionId,
      messageId: searchBinding.operation.messageId,
      operation: {
        runId: searchBinding.operation.runId,
        requestSeq: searchBinding.operation.requestSeq,
        providerToolCallId: searchBinding.operation.providerToolCallId
      },
      toolName: 'exec',
      toolSource: 'agent',
      normalizedArguments: { command: 'deepchat tool search --query calendar' },
      target: { serverName: 'agent-filesystem', originalName: 'exec' }
    })
    registration.armOuterDispatch({ ...outerDispatch, operation: searchBinding.operation })
    const armed = registration.takeArmedToken()
    const responseText = '{"tools":[]}\nExit Code: 0'

    registry.recordDiscoveryResult(armed.programmaticOperation, {
      responseText,
      isError: false
    })
    expect(registration.takeCompletedInvocationResult()).toEqual({ responseText, isError: false })
    expect(registration.settleOuterOutcome({ responseText, isError: false })).toMatchObject({
      created: true
    })
    expect(authority.beginRequest(armed.token)).toEqual({ status: 'invalid' })
    expect(
      entries.filter(
        (entry) =>
          entry.name === 'execution/dispatch_committed' || entry.name === 'execution/tool_outcome'
      )
    ).toHaveLength(2)
    expect(entries.every((entry) => !entry.payload_json.includes(responseText))).toBe(true)
  })

  it('settles a known launch error when live View authority is revoked after outer T1', () => {
    const operationBinding = binding()
    const { table } = createTapeTableMock()
    const journal = new ExecutionJournalService(() => table)
    const authority = new AgentCliTokenAuthority({
      createToken: () => 's'.repeat(43),
      createTokenId: () => 'revoked-programmatic-token'
    })
    const registry = new ProgrammaticToolParentRegistry({
      tokenAuthority: authority,
      executionJournal: journal
    })
    let active = true
    journal.commitRunStarted({
      sessionId: operationBinding.operation.sessionId,
      runId: operationBinding.operation.runId,
      messageId: operationBinding.operation.messageId,
      runKind: 'loop'
    })
    const registration = registry.prepare({
      binding: operationBinding,
      assertAuthorityActive: () => {
        if (!active) throw new Error('View revoked')
      }
    })
    const outerDispatch = journal.commitDispatch({
      sessionId: operationBinding.operation.sessionId,
      messageId: operationBinding.operation.messageId,
      operation: {
        runId: operationBinding.operation.runId,
        requestSeq: operationBinding.operation.requestSeq,
        providerToolCallId: operationBinding.operation.providerToolCallId
      },
      toolName: 'exec',
      toolSource: 'agent',
      normalizedArguments: { command: 'deepchat tool call', stdin: '{}' },
      target: { serverName: 'agent-filesystem', originalName: 'exec' }
    })
    active = false

    expect(() =>
      registration.armOuterDispatch({
        ...outerDispatch,
        operation: operationBinding.operation
      })
    ).toThrow('View revoked')
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
    expect(registration.settleProcessFailure({ responseText: 'View revoked' })).toMatchObject({
      result: { responseText: 'View revoked', isError: true },
      receipt: { created: true }
    })
    expect(() => registry.assertRunTerminalAllowed(RUN)).not.toThrow()
  })

  it('blocks Run terminal before outer settlement and does not invoke its writer', () => {
    const { registry } = setup()
    const commit = vi.fn(() => ({ sessionId: RUN.sessionId, entryId: 99, created: true }))

    expect(() => registry.commitRunTerminal(RUN, commit)).toThrow(
      /has not settled its outer outcome/
    )
    expect(commit).not.toHaveBeenCalled()
  })

  it('parks a nested T1-only operation until its child and outer outcomes are durable', () => {
    const { controller, journal, operationBinding, registration, registry } = setup()
    const outerDispatch = journal.commitDispatch({
      sessionId: operationBinding.operation.sessionId,
      messageId: operationBinding.operation.messageId,
      operation: {
        runId: operationBinding.operation.runId,
        requestSeq: operationBinding.operation.requestSeq,
        providerToolCallId: operationBinding.operation.providerToolCallId
      },
      toolName: 'exec',
      toolSource: 'agent',
      normalizedArguments: { command: 'deepchat tool call', stdin: '{}' },
      target: { serverName: 'agent-filesystem', originalName: 'exec' }
    })
    registration.armOuterDispatch({ ...outerDispatch, operation: operationBinding.operation })
    registration.takeArmedToken()
    const argumentTemplate = { arguments: { value: 'write' }, bindings: [] }
    controller.reserveChildren([
      {
        childOrdinal: 0,
        toolName: 'remote_write',
        toolSource: 'mcp',
        target: { serverName: 'remote', originalName: 'remote_write' },
        definitionHash: '4'.repeat(64),
        argumentTemplate
      }
    ])
    controller.materializeChild({
      childOrdinal: 0,
      argumentTemplate,
      normalizedArguments: { value: 'write' }
    })
    controller.commitChildDispatch(0, {
      toolName: 'remote_write',
      toolSource: 'mcp',
      normalizedArguments: { value: 'write' },
      target: { serverName: 'remote', originalName: 'remote_write' }
    })
    const commit = vi.fn(() => ({ sessionId: RUN.sessionId, entryId: 99, created: true }))

    expect(() => registry.commitRunTerminal(RUN, commit)).toThrow(
      /has not settled its outer outcome/
    )
    expect(() => registration.settleProcessFailure({ responseText: 'cancelled' })).toThrow(
      /unsettled child outcome/
    )
    expect(commit).not.toHaveBeenCalled()

    controller.commitChildOutcome({ childOrdinal: 0, responseText: 'written', isError: false })
    expect(() => registry.commitRunTerminal(RUN, commit)).toThrow(
      /has not settled its outer outcome/
    )
    controller.completeToolInvocation({ responseText: 'written', isError: false })
    expect(registration.settleProcessFailure({ responseText: 'cancelled' })).toMatchObject({
      result: { responseText: 'written', isError: false },
      receipt: { created: true }
    })

    expect(registry.commitRunTerminal(RUN, commit)).toMatchObject({ created: true })
    expect(commit).toHaveBeenCalledOnce()
  })

  it('releases a deleted Session without inventing outcomes for a nested T1-only operation', () => {
    const { authority, controller, entries, journal, operationBinding, registration, registry } =
      setup()
    const outerDispatch = journal.commitDispatch({
      sessionId: operationBinding.operation.sessionId,
      messageId: operationBinding.operation.messageId,
      operation: {
        runId: operationBinding.operation.runId,
        requestSeq: operationBinding.operation.requestSeq,
        providerToolCallId: operationBinding.operation.providerToolCallId
      },
      toolName: 'exec',
      toolSource: 'agent',
      normalizedArguments: { command: 'deepchat tool call', stdin: '{}' },
      target: { serverName: 'agent-filesystem', originalName: 'exec' }
    })
    registration.armOuterDispatch({ ...outerDispatch, operation: operationBinding.operation })
    registration.takeArmedToken()
    const argumentTemplate = { arguments: { value: 'write' }, bindings: [] }
    controller.reserveChildren([
      {
        childOrdinal: 0,
        toolName: 'remote_write',
        toolSource: 'mcp',
        target: { serverName: 'remote', originalName: 'remote_write' },
        definitionHash: '4'.repeat(64),
        argumentTemplate
      }
    ])
    controller.materializeChild({
      childOrdinal: 0,
      argumentTemplate,
      normalizedArguments: { value: 'write' }
    })
    controller.commitChildDispatch(0, {
      toolName: 'remote_write',
      toolSource: 'mcp',
      normalizedArguments: { value: 'write' },
      target: { serverName: 'remote', originalName: 'remote_write' }
    })
    const journalEventCount = entries.length

    expect(() => registry.assertRunTerminalAllowed(RUN)).toThrow(/has not settled/)
    registry.releaseSession('another-session')
    expect(() => registry.assertRunTerminalAllowed(RUN)).toThrow(/has not settled/)

    registry.releaseSession(RUN.sessionId)

    expect(entries).toHaveLength(journalEventCount)
    expect(
      entries.some(
        (entry) =>
          entry.name === 'execution/tool_outcome' || entry.name === 'execution/run_terminal'
      )
    ).toBe(false)
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
    expect(() => registry.assertRunTerminalAllowed(RUN)).not.toThrow()
    expect(() => registration.takeCompletedInvocationResult()).toThrow(/no longer active/)
  })

  it('arms from the real outer T1 receipt and settles outer T2 before Run terminal', () => {
    const { authority, controller, journal, operationBinding, registration, registry } = setup()
    const outerDispatch = journal.commitDispatch({
      sessionId: operationBinding.operation.sessionId,
      messageId: operationBinding.operation.messageId,
      operation: {
        runId: operationBinding.operation.runId,
        requestSeq: operationBinding.operation.requestSeq,
        providerToolCallId: operationBinding.operation.providerToolCallId
      },
      toolName: 'exec',
      toolSource: 'agent',
      normalizedArguments: { command: 'deepchat tool call' },
      target: { serverName: 'agent-filesystem', originalName: 'exec' }
    })
    registration.armOuterDispatch({
      ...outerDispatch,
      operation: operationBinding.operation
    })
    const armed = registration.takeArmedToken()
    controller.failBeforeChildPlan()
    expect(authority.beginRequest(armed.token)).toEqual({ status: 'invalid' })
    expect(
      registration.settleOuterOutcome({ responseText: 'request rejected', isError: true })
    ).toMatchObject({ created: true })

    const terminalReceipt = { sessionId: 'session-1', entryId: 99, created: true }
    const commit = vi.fn(() => terminalReceipt)
    expect(registry.commitRunTerminal(RUN, commit)).toEqual(terminalReceipt)
    expect(commit).toHaveBeenCalledOnce()
  })

  it('keeps a settled registration fenced when terminal persistence fails', () => {
    const { controller, journal, operationBinding, registration, registry } = setup()
    const outerDispatch = journal.commitDispatch({
      sessionId: operationBinding.operation.sessionId,
      messageId: operationBinding.operation.messageId,
      operation: {
        runId: operationBinding.operation.runId,
        requestSeq: operationBinding.operation.requestSeq,
        providerToolCallId: operationBinding.operation.providerToolCallId
      },
      toolName: 'exec',
      toolSource: 'agent',
      normalizedArguments: { command: 'deepchat tool call' },
      target: { serverName: 'agent-filesystem', originalName: 'exec' }
    })
    registration.armOuterDispatch({ ...outerDispatch, operation: operationBinding.operation })
    controller.failBeforeChildPlan()
    registration.settleOuterOutcome({ responseText: 'request rejected', isError: true })

    expect(() =>
      registry.commitRunTerminal(RUN, () => {
        throw new Error('disk full')
      })
    ).toThrow('disk full')
    expect(() => registry.assertRunTerminalAllowed(RUN)).not.toThrow()
    expect(() =>
      registration.settleOuterOutcome({ responseText: 'request rejected', isError: true })
    ).toThrow(/settled, expected armed/)
  })

  it('rejects duplicate process-live registrations for one provider operation', () => {
    const { controller, registry } = setup()
    expect(() => registry.register(controller)).toThrow(/already registered/)
  })

  it('retains settled registrations when terminal persistence reports an existing fact', () => {
    const { controller, journal, operationBinding, registration, registry } = setup()
    const outerDispatch = journal.commitDispatch({
      sessionId: operationBinding.operation.sessionId,
      messageId: operationBinding.operation.messageId,
      operation: {
        runId: operationBinding.operation.runId,
        requestSeq: operationBinding.operation.requestSeq,
        providerToolCallId: operationBinding.operation.providerToolCallId
      },
      toolName: 'exec',
      toolSource: 'agent',
      normalizedArguments: { command: 'deepchat tool call' },
      target: { serverName: 'agent-filesystem', originalName: 'exec' }
    })
    registration.armOuterDispatch({ ...outerDispatch, operation: operationBinding.operation })
    controller.failBeforeChildPlan()
    registration.settleOuterOutcome({ responseText: 'request rejected', isError: true })

    expect(
      registry.commitRunTerminal(RUN, () => ({
        sessionId: RUN.sessionId,
        entryId: 100,
        created: false
      }))
    ).toMatchObject({ created: false })
    expect(() => registry.assertRunTerminalAllowed(RUN)).not.toThrow()
    expect(() =>
      registration.settleOuterOutcome({ responseText: 'request rejected', isError: true })
    ).toThrow(/settled, expected armed/)
  })

  it('revokes a conflicting prepared grant for the same provider operation', () => {
    const { journal, operationBinding, registry } = setup()
    const authority = new AgentCliTokenAuthority({
      createToken: () => 'q'.repeat(43),
      createTokenId: () => 'conflicting-programmatic-token'
    })
    const prepared = authority.prepareProgrammaticOperation({
      binding: { ...operationBinding, capabilityHash: '4'.repeat(64) },
      assertAuthorityActive: () => undefined
    })
    const conflicting = new ProgrammaticToolParentController(prepared, journal)

    expect(() => registry.register(conflicting)).toThrow(/already registered/)
    expect(conflicting.state).toBe('revoked')
    expect(authority.snapshot()).toEqual({ tokens: 0, conversations: 0 })
  })
})
