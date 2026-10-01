import {
  sumModelUsage,
  type ModelUsage,
  type SessionUsageUpdate,
  type LodyExtensionCapabilities
} from 'acp-extension-core'
import type { AcpExtensionState, AcpUsageLedger } from '@shared/types/acp-extensions'

const counters = [
  'inputTokens',
  'outputTokens',
  'cacheReadInputTokens',
  'cacheCreationInputTokens',
  'reasoningOutputTokens',
  'webSearchRequests'
] as const

export function mergeAcpUsage(
  previous: AcpUsageLedger | undefined,
  update: SessionUsageUpdate,
  connectionId: string
): AcpUsageLedger {
  const next: AcpUsageLedger = {
    scopes: { ...previous?.scopes },
    modelUsage: {},
    total: sumModelUsage({}),
    incomplete: previous?.incomplete ?? false,
    inheritedBaseline: previous?.inheritedBaseline,
    latest: update.usage,
    unscopedConnectionId: previous?.unscopedConnectionId
  }
  const scopeId = update._meta?.lody?.usageScopeId
  const key = scopeId ? `scope:${scopeId}` : 'session'
  if (!scopeId) {
    if (previous?.unscopedConnectionId && previous.unscopedConnectionId !== connectionId)
      next.incomplete = true
    next.unscopedConnectionId = connectionId
  }
  const priorRows = next.scopes[key] ?? {}
  if (!update.modelUsage) next.incomplete = true
  else if (!Object.hasOwn(next.scopes, key) && Object.keys(next.scopes).length >= 4096) {
    // ponytail: bounded metadata ledger; use an on-disk ledger for longer accounting lifetimes.
    next.incomplete = true
  } else {
    const rows: Record<string, ModelUsage> = Object.assign(Object.create(null), priorRows)
    for (const [modelId, current] of Object.entries(update.modelUsage)) {
      const prior = Object.hasOwn(rows, modelId) ? rows[modelId] : undefined
      const merged = { ...prior, ...current }
      for (const counter of counters) {
        if (prior?.[counter] !== undefined && (current[counter] ?? prior[counter]) < prior[counter])
          next.incomplete = true
        if (prior?.[counter] !== undefined)
          merged[counter] = Math.max(prior[counter], current[counter] ?? 0)
      }
      if (current.costUSD === undefined) delete merged.costUSD
      else if (prior?.costUSD !== undefined && current.costUSD < prior.costUSD) {
        next.incomplete = true
        merged.costUSD = prior.costUSD
      }
      rows[modelId] = merged
    }
    next.scopes[key] = rows
  }
  const models = new Map<string, Record<string, ModelUsage>>()
  for (const [scope, rows] of Object.entries(next.scopes))
    for (const [model, row] of Object.entries(rows)) {
      const contributions = models.get(model) ?? {}
      contributions[scope] = row
      models.set(model, contributions)
    }
  next.modelUsage = Object.fromEntries(
    [...models].map(([model, rows]) => {
      const contextWindow =
        update.modelUsage?.[model]?.contextWindow ?? previous?.modelUsage[model]?.contextWindow
      return [
        model,
        { ...sumModelUsage(rows), ...(contextWindow === undefined ? {} : { contextWindow }) }
      ]
    })
  )
  next.total = sumModelUsage(next.modelUsage)
  next.sinceFork = getAcpUsageSinceFork(next)
  return next
}

export function createAcpExtensionState(
  connectionId: string,
  remoteSessionId: string,
  capabilities: LodyExtensionCapabilities,
  previous?: AcpExtensionState
): AcpExtensionState {
  const matching =
    previous?.version === 1 && previous.remoteSessionId === remoteSessionId ? previous : undefined
  const restored =
    matching && matching.connectionId !== connectionId
      ? disconnectAcpExtensionState(matching)
      : matching
  return {
    ...restored,
    version: 1,
    revision: (restored?.revision ?? 0) + 1,
    connectionId,
    remoteSessionId,
    capabilities,
    connected: true,
    tasks: restored?.tasks ?? {},
    remoteTasks: restored?.remoteTasks ?? [],
    runs: restored?.runs ?? {},
    steers: restored?.steers ?? {}
  }
}

export function disconnectAcpExtensionState(state: AcpExtensionState): AcpExtensionState {
  return {
    ...state,
    connected: false,
    revision: state.revision + 1,
    context: state.context ? { ...state.context, stale: true } : undefined,
    tasksStale: true,
    freshTaskIds: [],
    runs: Object.fromEntries(
      Object.entries(state.runs).map(([id, run]) => [
        id,
        {
          ...run,
          outputIncomplete: true,
          snapshot:
            run.snapshot && ['pending', 'running'].includes(run.snapshot.state)
              ? {
                  ...run.snapshot,
                  state: 'unknown',
                  outputIncomplete: true,
                  reason: { code: 'disconnected' }
                }
              : run.snapshot
        }
      ])
    ),
    steers: Object.fromEntries(
      Object.entries(state.steers).map(([id, status]) => [
        id,
        status === 'accepted' ? 'unknown' : status
      ])
    )
  }
}

export function getAcpUsageSinceFork(ledger: AcpUsageLedger): ModelUsage | undefined {
  if (!ledger.inheritedBaseline) return undefined
  const rows = Object.fromEntries(
    Object.entries(ledger.modelUsage).map(([model, usage]) => {
      const baseline = Object.hasOwn(ledger.inheritedBaseline!, model)
        ? ledger.inheritedBaseline![model]
        : undefined
      const row = { ...usage }
      for (const counter of counters)
        if (row[counter] !== undefined)
          row[counter] = Math.max(0, row[counter]! - (baseline?.[counter] ?? 0))
      if (usage.costUSD !== undefined && (!baseline || baseline.costUSD !== undefined))
        row.costUSD = Math.max(0, usage.costUSD - (baseline?.costUSD ?? 0))
      else delete row.costUSD
      return [model, row]
    })
  )
  return sumModelUsage(rows)
}
