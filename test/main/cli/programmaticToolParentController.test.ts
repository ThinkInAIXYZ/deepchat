import { describe, expect, it } from 'vitest'
import {
  AGENT_CLI_PROGRAMMATIC_GRANT_SCHEMA_VERSION,
  AgentCliTokenAuthority,
  type AgentCliProgrammaticOperationBinding
} from '@/cli/agentTokenAuthority'
import { LOCAL_CONTROL_PROGRAMMATIC_ROUTE_SURFACE_VERSION } from '@shared/contracts/localControl'
import {
  ProgrammaticParentOperationError,
  ProgrammaticToolParentController,
  type ProgrammaticChildReservation
} from '@/cli/programmaticToolParentController'
import { ExecutionJournalService } from '@/tape/application/executionJournalService'
import { hashJsonData } from '@/tape/domain/canonicalJson'
import { parseExecutionJournalFact } from '@/tape/domain/executionJournal'
import { createTapeTableMock } from '../session/data/tapeTestHarness'

const RUN_ID = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'p'.repeat(43)

function binding(
  overrides: Partial<AgentCliProgrammaticOperationBinding> = {}
): AgentCliProgrammaticOperationBinding {
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
    },
    ...overrides
  }
}

function child(childOrdinal: number, originalName = `tool-${childOrdinal}`) {
  return {
    childOrdinal,
    toolName: `server__${originalName}`,
    toolSource: 'mcp' as const,
    target: { serverName: 'server', originalName },
    definitionHash: String(childOrdinal + 4).repeat(64),
    argumentTemplate: {
      arguments: { query: originalName },
      bindings: []
    }
  } satisfies ProgrammaticChildReservation
}

function materializeChild(
  controller: ProgrammaticToolParentController,
  childOrdinal: number,
  originalName = `tool-${childOrdinal}`
): void {
  controller.materializeChild({
    childOrdinal,
    argumentTemplate: child(childOrdinal, originalName).argumentTemplate,
    normalizedArguments: { query: originalName }
  })
}

function childDispatch(
  childOrdinal: number,
  originalName = `tool-${childOrdinal}`,
  normalizedArguments: Record<string, unknown> = { query: originalName }
) {
  return {
    toolName: `server__${originalName}`,
    toolSource: 'mcp' as const,
    normalizedArguments,
    target: { serverName: 'server', originalName }
  }
}

function setup(operationBinding = binding()) {
  const { table, entries } = createTapeTableMock()
  const journal = new ExecutionJournalService(() => table)
  const authority = new AgentCliTokenAuthority({
    createToken: () => TOKEN,
    createTokenId: () => 'programmatic-token-1'
  })
  const prepared = authority.prepareProgrammaticOperation({
    binding: operationBinding,
    assertAuthorityActive: () => undefined
  })
  const controller = new ProgrammaticToolParentController(prepared, journal)
  journal.commitRunStarted({
    sessionId: operationBinding.operation.sessionId,
    runId: operationBinding.operation.runId,
    messageId: operationBinding.operation.messageId,
    runKind: 'loop'
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
    normalizedArguments: { command: 'deepchat tool call' },
    target: { serverName: 'agent-filesystem', originalName: 'exec' }
  })
  const armed = controller.armOuterDispatch({
    ...outerDispatch,
    operation: operationBinding.operation
  })
  return { authority, controller, entries, journal, armed, table }
}

describe('ProgrammaticToolParentController', () => {
  it('settles a real child between outer T1 and T2 and revokes its one-use grant', () => {
    const { authority, controller, entries, journal, armed } = setup()
    controller.reserveChildren([child(0)])

    materializeChild(controller, 0)
    expect(controller.commitChildDispatch(0, childDispatch(0))).toMatchObject({ created: true })
    expect(() =>
      controller.completeToolInvocation({ responseText: 'outer', isError: false })
    ).toThrow(/unsettled children/)
    expect(
      controller.commitChildOutcome({
        childOrdinal: 0,
        responseText: 'child result',
        isError: false
      })
    ).toMatchObject({ created: true })

    controller.completeToolInvocation({
      responseText: 'canonical outer result',
      isError: false
    })
    expect(controller.takeCompletedInvocationResult()).toEqual({
      responseText: 'canonical outer result',
      isError: false
    })
    const settlement = controller.issueSettlementReceipt({
      responseText: 'canonical outer result',
      isError: false
    })
    expect(settlement).toMatchObject({
      outerDispatchEntryId: 3,
      capabilityHash: '2'.repeat(64),
      startedChildren: 1,
      settledChildren: 1
    })
    expect(
      controller.commitOuterOutcome(settlement, {
        responseText: 'canonical outer result',
        isError: false
      })
    ).toMatchObject({ created: true })
    expect(controller.state).toBe('settled')
    expect(() => controller.assertRunTerminalAllowed()).not.toThrow()
    expect(authority.beginRequest(armed.token)).toEqual({ status: 'invalid' })
    expect(
      journal.commitRunTerminal({
        sessionId: 'session-1',
        runId: RUN_ID,
        messageId: 'assistant-1',
        outcome: 'completed',
        stopReason: 'complete'
      })
    ).toMatchObject({ created: true })

    const facts = entries
      .filter((entry) => entry.name?.startsWith('execution/'))
      .map(parseExecutionJournalFact)
    expect(facts.map((fact) => [fact.protocolVersion, fact.type])).toEqual([
      [1, 'execution/run_started'],
      [1, 'execution/dispatch_committed'],
      [2, 'execution/dispatch_committed'],
      [2, 'execution/tool_outcome'],
      [1, 'execution/tool_outcome'],
      [1, 'execution/run_terminal']
    ])
    expect(entries.every((entry) => !entry.payload_json.includes('child result'))).toBe(true)
    expect(entries.every((entry) => !entry.payload_json.includes('canonical outer result'))).toBe(
      true
    )
  })

  it('requires exact outer operation identity and revokes a failed arm before use', () => {
    const { table } = createTapeTableMock()
    const journal = new ExecutionJournalService(() => table)
    const authority = new AgentCliTokenAuthority({
      createToken: () => TOKEN,
      createTokenId: () => 'programmatic-token-1'
    })
    const prepared = authority.prepareProgrammaticOperation({
      binding: binding(),
      assertAuthorityActive: () => undefined
    })
    const controller = new ProgrammaticToolParentController(prepared, journal)

    expect(() =>
      controller.armOuterDispatch({
        sessionId: 'session-1',
        entryId: 2,
        created: true,
        operation: { ...binding().operation, providerToolCallId: 'wrong-call' }
      })
    ).toThrow(/newly committed outer dispatch receipt/)
    expect(controller.state).toBe('fatal')
    expect(authority.beginRequest(TOKEN)).toEqual({ status: 'invalid' })
  })

  it('reserves contiguous children and enforces sequential fail-fast dispatch', () => {
    const batchBinding = binding({
      command: { domain: 'tool', verb: 'batch' },
      route: 'tool.batch'
    })
    const rejected = setup(batchBinding)
    expect(() => rejected.controller.reserveChildren([child(1)])).toThrow(
      /contiguous canonical plan/
    )
    expect(() => rejected.controller.reserveChildren([child(0), child(1)])).toThrow(
      /already reserved/
    )

    const { controller, entries } = setup(batchBinding)
    controller.reserveChildren([child(0), child(1)])
    expect(() => controller.commitChildDispatch(1, childDispatch(1))).toThrow(
      /dispatch sequentially/
    )

    materializeChild(controller, 0)
    controller.commitChildDispatch(0, childDispatch(0))
    controller.commitChildOutcome({ childOrdinal: 0, responseText: 'failed', isError: true })
    expect(() => controller.commitChildDispatch(1, childDispatch(1))).toThrow(
      /stop after a child error/
    )
    expect(() =>
      controller.issueSettlementReceipt({ responseText: 'success', isError: false })
    ).toThrow(/requires an outer error result/)
    const settlement = controller.issueSettlementReceipt({ responseText: 'failed', isError: true })
    controller.commitOuterOutcome(settlement, { responseText: 'failed', isError: true })
    expect(
      entries.filter(
        (entry) =>
          entry.name === 'execution/dispatch_committed' &&
          JSON.parse(entry.meta_json).protocolVersion === 2
      )
    ).toHaveLength(1)
  })

  it('settles every successful batch child before issuing the outer receipt', () => {
    const { controller, entries } = setup(
      binding({
        command: { domain: 'tool', verb: 'batch' },
        route: 'tool.batch'
      })
    )
    controller.reserveChildren([child(0), child(1)])
    for (const childOrdinal of [0, 1]) {
      materializeChild(controller, childOrdinal)
      controller.commitChildDispatch(childOrdinal, childDispatch(childOrdinal))
      controller.commitChildOutcome({
        childOrdinal,
        responseText: `result-${childOrdinal}`,
        isError: false
      })
    }
    const responseText = '{"steps":["result-0","result-1"]}\nExit Code: 0'
    controller.completeToolInvocation({ responseText, isError: false })
    expect(controller.takeCompletedInvocationResult()).toEqual({ responseText, isError: false })

    const settlement = controller.issueSettlementReceipt({ responseText, isError: false })
    expect(settlement).toMatchObject({ startedChildren: 2, settledChildren: 2, isError: false })
    controller.commitOuterOutcome(settlement, { responseText, isError: false })

    const nestedEntries = entries.filter(
      (entry) => JSON.parse(entry.meta_json).protocolVersion === 2
    )
    expect(
      nestedEntries.filter((entry) => entry.name === 'execution/dispatch_committed')
    ).toHaveLength(2)
    expect(nestedEntries.filter((entry) => entry.name === 'execution/tool_outcome')).toHaveLength(2)
  })

  it('records no child fact for a deterministic pre-T1 refusal', () => {
    const batchBinding = binding({
      command: { domain: 'tool', verb: 'batch' },
      route: 'tool.batch'
    })
    const { controller, entries } = setup(batchBinding)
    controller.reserveChildren([child(0), child(1)])
    controller.stopBeforeChild(0)
    const settlement = controller.issueSettlementReceipt({ responseText: 'denied', isError: true })
    controller.commitOuterOutcome(settlement, { responseText: 'denied', isError: true })

    expect(entries.some((entry) => JSON.parse(entry.meta_json).protocolVersion === 2)).toBe(false)
  })

  it('settles a known outer error when the CLI fails before submitting a child plan', () => {
    const { authority, armed, controller, entries } = setup()
    controller.failBeforeChildPlan()
    expect(authority.beginRequest(armed.token)).toEqual({ status: 'invalid' })
    const settlement = controller.issueSettlementReceipt({
      responseText: 'CLI process failed before request admission',
      isError: true
    })
    controller.commitOuterOutcome(settlement, {
      responseText: 'CLI process failed before request admission',
      isError: true
    })

    expect(controller.state).toBe('settled')
    expect(entries.some((entry) => JSON.parse(entry.meta_json).protocolVersion === 2)).toBe(false)
  })

  it('settles a process failure after plan reservation when no child outcome is unknown', () => {
    const { controller, entries } = setup()
    controller.reserveChildren([child(0)])

    const result = controller.resolveProcessFailureResult({
      responseText: 'CLI process exited before dispatch',
      isError: true
    })
    const settlement = controller.issueSettlementReceipt(result)
    controller.commitOuterOutcome(settlement, result)

    expect(result).toEqual({
      responseText: 'CLI process exited before dispatch',
      isError: true
    })
    expect(settlement).toMatchObject({ startedChildren: 0, settledChildren: 0 })
    expect(controller.state).toBe('settled')
    expect(entries.some((entry) => JSON.parse(entry.meta_json).protocolVersion === 2)).toBe(false)
  })

  it('recovers the process-live result when the CLI exits after every child settles', () => {
    const { controller } = setup()
    controller.reserveChildren([child(0)])
    materializeChild(controller, 0)
    controller.commitChildDispatch(0, childDispatch(0))
    controller.commitChildOutcome({ childOrdinal: 0, responseText: 'child result', isError: false })
    controller.completeToolInvocation({ responseText: 'authoritative result', isError: false })

    const result = controller.resolveProcessFailureResult({
      responseText: 'CLI process exited',
      isError: true
    })
    const settlement = controller.issueSettlementReceipt(result)
    controller.commitOuterOutcome(settlement, result)

    expect(result).toEqual({ responseText: 'authoritative result', isError: false })
    expect(settlement).toMatchObject({ startedChildren: 1, settledChildren: 1, isError: false })
    expect(controller.state).toBe('settled')
  })

  it('binds discovery settlement to one process-live authoritative result', () => {
    const searchBinding = binding({
      command: { domain: 'tool', verb: 'search' },
      route: 'tool.search'
    })
    const { controller, entries } = setup(searchBinding)
    controller.completeDiscoveryInvocation({
      responseText: '{"tools":[]}\nExit Code: 0',
      isError: false
    })

    expect(controller.takeCompletedInvocationResult()).toEqual({
      responseText: '{"tools":[]}\nExit Code: 0',
      isError: false
    })
    expect(() => controller.takeCompletedInvocationResult()).toThrow(/no unclaimed authoritative/)
    expect(() =>
      controller.issueSettlementReceipt({ responseText: 'forged error', isError: true })
    ).toThrow(/does not match its authoritative invocation result/)
    expect(controller.state).toBe('fatal')
    expect(entries.some((entry) => entry.name === 'execution/tool_outcome')).toBe(false)

    const duplicated = setup(searchBinding)
    duplicated.controller.completeDiscoveryInvocation({
      responseText: '{"tools":[]}\nExit Code: 0',
      isError: false
    })
    expect(() =>
      duplicated.controller.completeDiscoveryInvocation({
        responseText: '{"tools":[]}\nExit Code: 0',
        isError: false
      })
    ).toThrow(/more than one authoritative result/)
    expect(duplicated.controller.state).toBe('fatal')

    const settled = setup(searchBinding)
    const responseText = '{"tools":[]}\nExit Code: 0'
    settled.controller.completeDiscoveryInvocation({
      responseText,
      isError: false
    })
    settled.controller.takeCompletedInvocationResult()
    const receipt = settled.controller.issueSettlementReceipt({
      responseText,
      isError: false
    })
    expect(
      settled.controller.commitOuterOutcome(receipt, {
        responseText,
        isError: false
      })
    ).toMatchObject({ created: true })
    expect(settled.controller.state).toBe('settled')
    expect(settled.entries.some((entry) => JSON.parse(entry.meta_json).protocolVersion === 2)).toBe(
      false
    )
  })

  it('settles discovery launch failure without inventing a child operation', () => {
    const describeBinding = binding({
      command: { domain: 'tool', verb: 'describe' },
      route: 'tool.describe'
    })
    const { authority, armed, controller, entries } = setup(describeBinding)

    controller.failBeforeDiscoveryResult()
    expect(authority.beginRequest(armed.token)).toEqual({ status: 'invalid' })
    const settlement = controller.issueSettlementReceipt({
      responseText: 'Error: discovery request failed before completion',
      isError: true
    })
    controller.commitOuterOutcome(settlement, {
      responseText: 'Error: discovery request failed before completion',
      isError: true
    })

    expect(controller.state).toBe('settled')
    expect(entries.some((entry) => JSON.parse(entry.meta_json).protocolVersion === 2)).toBe(false)
  })

  it('parks an outer T1 when the settlement receipt is missing or mismatched', () => {
    const first = setup()
    first.controller.reserveChildren([child(0)])
    materializeChild(first.controller, 0)
    first.controller.commitChildDispatch(0, childDispatch(0))
    expect(() => first.controller.assertRunTerminalAllowed()).toThrow(/has not settled/)
    expect(() =>
      first.journal.commitRunTerminal({
        sessionId: 'session-1',
        runId: RUN_ID,
        messageId: 'assistant-1',
        outcome: 'error',
        stopReason: 'cancelled'
      })
    ).toThrow(/unsettled nested causality/)

    const second = setup()
    second.controller.reserveChildren([child(0)])
    second.controller.stopBeforeChild(0)
    const receipt = second.controller.issueSettlementReceipt({
      responseText: 'denied',
      isError: true
    })
    expect(() =>
      second.controller.commitOuterOutcome(receipt, {
        responseText: 'forged stdout',
        isError: true
      })
    ).toThrow(/does not match its process-live settlement receipt/)
    expect(second.controller.state).toBe('fatal')
    expect(second.entries.some((entry) => entry.name === 'execution/tool_outcome')).toBe(false)
  })

  it('freezes child arguments and journals plugin ownership resolved at live dispatch', () => {
    const { controller, entries } = setup()
    const reservation = child(0)
    controller.reserveChildren([reservation])
    const normalizedArguments = { nested: { value: 'reserved' } }
    controller.materializeChild({
      childOrdinal: 0,
      argumentTemplate: reservation.argumentTemplate,
      normalizedArguments
    })
    normalizedArguments.nested.value = 'mutated'
    controller.commitChildDispatch(0, {
      ...childDispatch(0, 'tool-0', { nested: { value: 'reserved' } }),
      target: { ...reservation.target, ownerPluginId: 'plugin-1' }
    })

    const nestedDispatch = entries
      .filter((entry) => entry.name?.startsWith('execution/'))
      .map(parseExecutionJournalFact)
      .find((fact) => fact.protocolVersion === 2 && fact.type === 'execution/dispatch_committed')
    expect(nestedDispatch).toMatchObject({
      target: {
        serverName: 'server',
        originalName: 'tool-0',
        ownerPluginId: 'plugin-1'
      },
      argumentsHash: hashJsonData({ nested: { value: 'reserved' } })
    })
  })

  it('makes a child dispatch target or argument mismatch fatal before nested T1', () => {
    const targetMismatch = setup()
    targetMismatch.controller.reserveChildren([child(0)])
    materializeChild(targetMismatch.controller, 0)
    expect(() =>
      targetMismatch.controller.commitChildDispatch(0, {
        ...childDispatch(0),
        target: { serverName: 'different-server', originalName: 'tool-0' }
      })
    ).toThrow(/does not match its reserved real target and arguments/)
    expect(targetMismatch.controller.state).toBe('fatal')
    expect(
      targetMismatch.entries.some(
        (entry) =>
          entry.name === 'execution/dispatch_committed' &&
          JSON.parse(entry.meta_json).protocolVersion === 2
      )
    ).toBe(false)

    const argumentMismatch = setup()
    argumentMismatch.controller.reserveChildren([child(0)])
    materializeChild(argumentMismatch.controller, 0)
    expect(() =>
      argumentMismatch.controller.commitChildDispatch(
        0,
        childDispatch(0, 'tool-0', { query: 'changed' })
      )
    ).toThrow(/does not match its reserved real target and arguments/)
    expect(argumentMismatch.controller.state).toBe('fatal')
  })

  it('rejects malformed reservation values with a bounded plan error', () => {
    const { armed, authority, controller } = setup()
    expect(() =>
      controller.reserveChildren([
        {
          ...child(0),
          toolName: 42,
          definitionHash: null
        } as unknown as ProgrammaticChildReservation
      ])
    ).toThrow(ProgrammaticParentOperationError)
    expect(() => controller.reserveChildren([child(0)])).toThrow(/already reserved/)
    expect(authority.beginRequest(armed.token)).toEqual({ status: 'invalid' })
    const settlement = controller.issueSettlementReceipt({
      responseText: 'invalid plan',
      isError: true
    })
    controller.commitOuterOutcome(settlement, { responseText: 'invalid plan', isError: true })
  })

  it('rejects a reserved plan whose templates exceed the aggregate input quota', () => {
    const { controller } = setup(
      binding({
        quotas: {
          ...binding().quotas,
          maxInputBytes: 16
        }
      })
    )
    expect(() =>
      controller.reserveChildren([
        {
          ...child(0),
          argumentTemplate: { value: 'this exceeds sixteen bytes' }
        }
      ])
    ).toThrow(/aggregate input quota/)
  })

  it('rejects template drift and post-materialization input amplification before child T1', () => {
    const first = setup()
    first.controller.reserveChildren([child(0)])
    expect(() =>
      first.controller.materializeChild({
        childOrdinal: 0,
        argumentTemplate: { arguments: { query: 'changed' }, bindings: [] },
        normalizedArguments: { query: 'changed' }
      })
    ).toThrow(/template changed after plan reservation/)
    const firstSettlement = first.controller.issueSettlementReceipt({
      responseText: 'invalid plan',
      isError: true
    })
    first.controller.commitOuterOutcome(firstSettlement, {
      responseText: 'invalid plan',
      isError: true
    })

    const second = setup(
      binding({
        quotas: {
          ...binding().quotas,
          maxInputBytes: 64
        }
      })
    )
    const reservation = {
      ...child(0),
      argumentTemplate: { bindings: [] }
    }
    second.controller.reserveChildren([reservation])
    expect(() =>
      second.controller.materializeChild({
        childOrdinal: 0,
        argumentTemplate: reservation.argumentTemplate,
        normalizedArguments: { value: 'x'.repeat(64) }
      })
    ).toThrow(/materialized arguments exceed/)
    expect(second.entries.some((entry) => JSON.parse(entry.meta_json).protocolVersion === 2)).toBe(
      false
    )
  })

  it('bounds aggregate child outputs separately from the canonical outer result', () => {
    const exact = setup(
      binding({
        quotas: {
          ...binding().quotas,
          maxOutputBytes: 8
        }
      })
    )
    exact.controller.reserveChildren([child(0)])
    materializeChild(exact.controller, 0)
    exact.controller.commitChildDispatch(0, childDispatch(0))
    exact.controller.commitChildOutcome({
      childOrdinal: 0,
      responseText: '12345678',
      isError: false
    })
    exact.controller.completeToolInvocation({ responseText: 'abcdefgh', isError: false })
    exact.controller.takeCompletedInvocationResult()
    const exactSettlement = exact.controller.issueSettlementReceipt({
      responseText: 'abcdefgh',
      isError: false
    })
    exact.controller.commitOuterOutcome(exactSettlement, {
      responseText: 'abcdefgh',
      isError: false
    })

    const aggregate = setup(
      binding({
        command: { domain: 'tool', verb: 'batch' },
        route: 'tool.batch',
        quotas: {
          ...binding().quotas,
          maxOutputBytes: 12
        }
      })
    )
    aggregate.controller.reserveChildren([child(0), child(1)])
    materializeChild(aggregate.controller, 0)
    aggregate.controller.commitChildDispatch(0, childDispatch(0))
    aggregate.controller.commitChildOutcome({
      childOrdinal: 0,
      responseText: '12345678',
      isError: false
    })
    materializeChild(aggregate.controller, 1)
    aggregate.controller.commitChildDispatch(1, childDispatch(1))
    expect(() =>
      aggregate.controller.commitChildOutcome({
        childOrdinal: 1,
        responseText: 'abcdefgh',
        isError: false
      })
    ).toThrow(/aggregate output quota/)
    expect(aggregate.controller.state).toBe('fatal')
    expect(
      aggregate.entries.filter(
        (entry) =>
          entry.name === 'execution/tool_outcome' &&
          JSON.parse(entry.meta_json).protocolVersion === 2
      )
    ).toHaveLength(1)
  })

  it('rejects an oversized canonical outer result without issuing a receipt', () => {
    const { controller, entries } = setup(
      binding({
        quotas: {
          ...binding().quotas,
          maxOutputBytes: 8
        }
      })
    )
    controller.reserveChildren([child(0)])
    controller.stopBeforeChild(0)
    expect(() =>
      controller.issueSettlementReceipt({ responseText: '123456789', isError: true })
    ).toThrow(/outer result exceeds/)
    expect(controller.state).toBe('fatal')
    expect(entries.some((entry) => entry.name === 'execution/tool_outcome')).toBe(false)
  })

  it('makes child outcome persistence failure fatal without issuing settlement', () => {
    const { authority, armed, controller, table } = setup()
    controller.reserveChildren([child(0)])
    materializeChild(controller, 0)
    controller.commitChildDispatch(0, childDispatch(0))
    table.appendExecutionJournalEvent.mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    expect(() =>
      controller.commitChildOutcome({ childOrdinal: 0, responseText: 'unknown', isError: true })
    ).toThrow(/Failed to persist execution\/tool_outcome/)
    expect(controller.state).toBe('fatal')
    expect(authority.beginRequest(armed.token)).toEqual({ status: 'invalid' })
    expect(() =>
      controller.issueSettlementReceipt({ responseText: 'unknown', isError: true })
    ).toThrow(/fatal, expected armed/)
  })

  it('makes outer outcome persistence failure fatal and leaves the operation parked', () => {
    const { authority, armed, controller, entries, table } = setup()
    controller.reserveChildren([child(0)])
    controller.stopBeforeChild(0)
    const settlement = controller.issueSettlementReceipt({ responseText: 'denied', isError: true })
    table.appendExecutionJournalEvent.mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    expect(() =>
      controller.commitOuterOutcome(settlement, { responseText: 'denied', isError: true })
    ).toThrow(/Failed to persist execution\/tool_outcome/)
    expect(controller.state).toBe('fatal')
    expect(authority.beginRequest(armed.token)).toEqual({ status: 'invalid' })
    expect(entries.some((entry) => entry.name === 'execution/tool_outcome')).toBe(false)
  })

  it('rejects settlement receipts from another controller and settled receipt replay', () => {
    const first = setup()
    first.controller.reserveChildren([child(0)])
    first.controller.stopBeforeChild(0)
    const firstReceipt = first.controller.issueSettlementReceipt({
      responseText: 'denied',
      isError: true
    })

    const second = setup()
    second.controller.reserveChildren([child(0)])
    second.controller.stopBeforeChild(0)
    const secondReceipt = second.controller.issueSettlementReceipt({
      responseText: 'denied',
      isError: true
    })
    expect(() =>
      second.controller.commitOuterOutcome(firstReceipt, {
        responseText: 'denied',
        isError: true
      })
    ).toThrow(/does not match its process-live settlement receipt/)
    expect(second.controller.state).toBe('fatal')

    first.controller.commitOuterOutcome(firstReceipt, {
      responseText: 'denied',
      isError: true
    })
    expect(() =>
      first.controller.commitOuterOutcome(firstReceipt, {
        responseText: 'denied',
        isError: true
      })
    ).toThrow(/settled, expected settlement-issued/)
    expect(secondReceipt).not.toBe(firstReceipt)
  })

  it('fails closed when a nested Journal commit fails', () => {
    const { controller, authority, table } = (() => {
      const fixture = createTapeTableMock()
      const journal = new ExecutionJournalService(() => fixture.table)
      const tokenAuthority = new AgentCliTokenAuthority({
        createToken: () => TOKEN,
        createTokenId: () => 'programmatic-token-1'
      })
      const prepared = tokenAuthority.prepareProgrammaticOperation({
        binding: binding(),
        assertAuthorityActive: () => undefined
      })
      journal.commitRunStarted({
        sessionId: 'session-1',
        runId: RUN_ID,
        messageId: 'assistant-1',
        runKind: 'loop'
      })
      const outerDispatch = journal.commitDispatch({
        sessionId: 'session-1',
        messageId: 'assistant-1',
        operation: {
          runId: RUN_ID,
          requestSeq: 1,
          providerToolCallId: 'exec-call-1'
        },
        toolName: 'exec',
        toolSource: 'agent',
        normalizedArguments: {},
        target: { serverName: 'agent-filesystem', originalName: 'exec' }
      })
      const parent = new ProgrammaticToolParentController(prepared, journal)
      parent.armOuterDispatch({ ...outerDispatch, operation: binding().operation })
      return { controller: parent, authority: tokenAuthority, table: fixture.table }
    })()
    controller.reserveChildren([child(0)])
    materializeChild(controller, 0)
    table.appendExecutionJournalEvent.mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    expect(() => controller.commitChildDispatch(0, childDispatch(0))).toThrow(
      /Failed to persist execution\/dispatch_committed/
    )
    expect(controller.state).toBe('fatal')
    expect(authority.beginRequest(TOKEN)).toEqual({ status: 'invalid' })
    expect(() => controller.assertRunTerminalAllowed()).toThrow(ProgrammaticParentOperationError)
  })
})
