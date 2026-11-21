import type { JsonValue } from '@shared/contracts/json'
import type { TapeInspectorFactRecord, TapeInspectorFacts } from '@shared/types/tape-inspector'
import type { SessionDatabase } from '@/session/data/database'
import type { DimSessionBinding } from '@/session/data/tables/dimSessionBindings'
import { dimSequence, type DimEvent } from './sessionConnection'

const object = (value: JsonValue | undefined): Record<string, JsonValue> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const text = (value: JsonValue | undefined) => (typeof value === 'string' ? value : undefined)
const preview = (value: JsonValue | undefined) =>
  typeof value === 'string' ? value.slice(0, 512) : undefined

/** A lossy, rebuildable list projection. It stores no canonical event payload or model request. */
export function indexDimInspectorEvent(
  database: SessionDatabase,
  scope: DimSessionBinding,
  event: DimEvent
): void {
  const table = database.dimTimelineInspectorTable
  const head = table.head(scope)
  const sequence = dimSequence(event.sequence).toString()
  if (dimSequence(sequence) <= dimSequence(head.cursor)) return
  const kind = `${event.type}/${event.name}`
  const source = object(event.data.source)
  const turnId = text(event.data.turn_id) ?? text(source.turn_id)
  const requestId = text(event.data.request_id) ?? text(source.request_id)
  const requestSeq = table.requestSequence(head, turnId, requestId)
  const eventCall = object(event.data.call)
  const baseCallId = text(event.data.call_id) ?? text(eventCall.id) ?? text(source.call_id)
  const resultItems =
    event.type === 'step' &&
    event.name === 'tool-result' &&
    Array.isArray(event.data.results) &&
    event.data.results.length
      ? event.data.results
      : event.type === 'step' &&
          event.name === 'tool-call' &&
          Array.isArray(event.data.calls) &&
          event.data.calls.length
        ? event.data.calls
        : [null]
  const family: TapeInspectorFactRecord['family'] =
    event.type === 'context'
      ? 'context'
      : kind.includes('tool')
        ? 'tool'
        : event.type === 'model' || kind.includes('model')
          ? 'attempt'
          : event.type === 'turn' || event.type === 'input'
            ? 'journal'
            : event.type === 'branch'
              ? 'lineage'
              : 'other'
  for (let ordinal = 0; ordinal < resultItems.length; ordinal++) {
    const item = object(resultItems[ordinal])
    const callId = text(item.call_id) ?? text(item.id) ?? baseCallId
    const callName = text(item.name) ?? text(eventCall.name) ?? text(event.data.name)
    const previous = callId && requestId ? table.toolFact(head, requestId, callId) : null
    const result = object(item.result ?? event.data.result)
    const isToolTerminal =
      kind === 'step/tool-completed' ||
      (kind === 'step/tool-result' && previous?.dim?.semanticName !== 'execution/tool_outcome')
    const semanticName =
      kind === 'turn/start'
        ? 'execution/run_started'
        : kind === 'turn/end'
          ? 'execution/run_terminal'
          : kind === 'step/tool-start'
            ? 'execution/dispatch_committed'
            : isToolTerminal
              ? 'execution/tool_outcome'
              : kind === 'model/call'
                ? 'provider/attempt_started'
                : kind === 'step/model-output-end'
                  ? 'provider/attempt_completed'
                  : undefined
    const status = text(event.data.status)
    const facts: TapeInspectorFacts = {
      ...((callName ?? previous?.facts?.toolName)
        ? { toolName: callName ?? previous?.facts?.toolName }
        : {}),
      ...(preview(event.data.delta ?? event.data.text ?? result.content)
        ? { contentPreview: preview(event.data.delta ?? event.data.text ?? result.content) }
        : {}),
      ...(status ? { status: status === 'failed' ? 'error' : status } : {}),
      ...(isToolTerminal
        ? {
            isError: result.isError === true,
            status: result.isError === true ? 'error' : 'success'
          }
        : {}),
      ...(text(event.data.error)
        ? { isError: true, contentPreview: preview(event.data.error), status: 'error' }
        : {}),
      ...(text(event.data.finish_reason) ? { stopReason: text(event.data.finish_reason) } : {})
    }
    const request = object(event.data.request)
    const nativeProvider = text(request.provider_id)
    if (nativeProvider) {
      const grant = database.dimProviderGrantsTable.get(nativeProvider)
      facts.providerId = grant?.providerId ?? nativeProvider
      facts.modelId = grant?.modelId ?? text(request.model_id)
    }
    const usage = object(event.data.usage)
    if (typeof usage.promptTokens === 'number' && typeof usage.completionTokens === 'number')
      facts.usage = {
        inputTokens: usage.promptTokens,
        outputTokens: usage.completionTokens,
        totalTokens:
          typeof usage.totalTokens === 'number'
            ? usage.totalTokens
            : usage.promptTokens + usage.completionTokens
      }
    table.put(
      head,
      { id: event.id, sequence, createdAt: event.create_at, name: kind },
      ordinal,
      {
        recordType: 'fact',
        kind: kind.includes('tool')
          ? isToolTerminal
            ? 'tool_result'
            : 'tool_call'
          : event.type === 'context'
            ? 'context'
            : 'event',
        family,
        name: kind,
        createdAt: event.create_at,
        sourceType: 'runtime_event',
        sourceId: event.id,
        ...(turnId
          ? { runId: turnId, messageId: `dim:${scope.dimSessionId}:${scope.branchId}:${turnId}` }
          : {}),
        ...(requestSeq ? { requestSeq } : {}),
        ...(callId ? { providerToolCallId: callId } : {}),
        dim: {
          sessionId: scope.dimSessionId,
          branchId: scope.branchId,
          eventId: event.id,
          sequence,
          ordinal,
          ...(requestId ? { requestId } : {}),
          ...(semanticName ? { semanticName } : {})
        },
        facts,
        integrity: 'unverified'
      },
      requestId
    )
  }
  table.advance(head, sequence)
}
