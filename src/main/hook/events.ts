import type { HookEventName } from '@shared/hooksNotifications'

export interface HookSessionFacts {
  readonly sessionId: string
  readonly agentId?: string | null
  readonly projectDir?: string | null
  readonly providerId?: string
  readonly modelId?: string
  readonly messageId?: string
}

export interface HookToolFacts {
  readonly callId?: string
  readonly name?: string
  readonly params?: string
  readonly response?: string
  readonly error?: string
}

export interface HookStopFacts {
  readonly reason?: string
  readonly userStop?: boolean
}

export interface HookErrorFacts {
  readonly message?: string
  readonly stack?: string
}

export type HookUsageFacts = Readonly<Record<string, number>>

export type HookPermissionFacts = Readonly<Record<string, unknown>>

type HookFactKey = 'promptPreview' | 'tool' | 'permission' | 'stop' | 'error' | 'usage'

/**
 * Closes a variant against every fact it does not declare. Excess property checking alone only
 * refuses surplus fields on a fresh literal, so a variable carrying both `stop` and `tool` would
 * otherwise satisfy the union.
 */
type Exclusive<TBody> = TBody & {
  readonly [TKey in Exclude<HookFactKey, keyof TBody>]?: never
}

export type HookEventBody =
  | Exclusive<{ readonly event: 'SessionStart'; readonly promptPreview?: string }>
  | Exclusive<{ readonly event: 'UserPromptSubmit'; readonly promptPreview: string }>
  | Exclusive<{ readonly event: 'PreToolUse'; readonly tool: HookToolFacts }>
  | Exclusive<{ readonly event: 'PostToolUse'; readonly tool: HookToolFacts }>
  | Exclusive<{ readonly event: 'PostToolUseFailure'; readonly tool: HookToolFacts }>
  | Exclusive<{
      readonly event: 'PermissionRequest'
      readonly tool: HookToolFacts
      readonly permission: HookPermissionFacts
    }>
  | Exclusive<{ readonly event: 'Stop'; readonly stop: HookStopFacts }>
  | Exclusive<{
      readonly event: 'SessionEnd'
      readonly usage?: HookUsageFacts | null
      readonly error?: HookErrorFacts | null
    }>

export type HookEvent = HookEventBody & { readonly session: HookSessionFacts }

type AssertNever<T extends never> = T
type AssertTrue<T extends true> = T
type Rejects<TCandidate> = TCandidate extends HookEventBody ? false : true

/** Fails compilation when HookEventBody and HOOK_EVENT_NAMES drift apart in either direction. */
export type HookEventCoverage = [
  AssertNever<Exclude<HookEventName, HookEventBody['event']>>,
  AssertNever<Exclude<HookEventBody['event'], HookEventName>>
]

/** Pins the combinations the union must refuse, for both missing and foreign facts. */
export type HookEventBodyRejections = [
  AssertTrue<Rejects<{ event: 'PreToolUse' }>>,
  AssertTrue<Rejects<{ event: 'UserPromptSubmit' }>>,
  AssertTrue<Rejects<{ event: 'PermissionRequest'; tool: HookToolFacts }>>,
  AssertTrue<Rejects<{ event: 'Stop'; stop: HookStopFacts; tool: HookToolFacts }>>,
  AssertTrue<Rejects<{ event: 'PostToolUse'; tool: HookToolFacts; stop: HookStopFacts }>>,
  AssertTrue<Rejects<{ event: 'SessionEnd'; stop: HookStopFacts }>>,
  AssertTrue<Rejects<{ event: 'SessionStart'; promptPreview: string; usage: HookUsageFacts }>>
]
