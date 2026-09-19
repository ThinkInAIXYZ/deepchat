import type { MCPContentItem } from '@shared/types/core/mcp'

const CUA_SNAPSHOT_TARGET_TOOLS = new Set([
  'click',
  'double_click',
  'right_click',
  'type_text',
  'press_key',
  'set_value',
  'scroll'
])

// Mirrors cua-driver-contract 0.6.0 ACTION_RESULT_TOOLS, excluding the hidden
// type_text_chars invoke alias that cannot appear in DeepChat's closed catalog.
const CUA_ACTION_RESULT_TOOLS = new Set([
  'click',
  'double_click',
  'right_click',
  'scroll',
  'drag',
  'mouse_drag',
  'parallel_mouse_drag',
  'move_cursor',
  'mouse_button_down',
  'mouse_button_up',
  'type_text',
  'press_key',
  'hotkey',
  'set_value',
  'set_window_frame',
  'invoke_menu',
  'browser_click',
  'browser_pointer',
  'browser_type'
])

const CUA_ACTION_EFFECTS = new Set([
  'confirmed',
  'partial',
  'unverifiable',
  'suspected_noop',
  'refused'
])
const CUA_ACTION_ROUTES = new Set([
  'accessibility',
  'synthetic_events',
  'global_input',
  'system_api',
  'dom',
  'trusted_input'
])
const CUA_ACTION_DELIVERY_MODES = new Set(['background', 'foreground', 'not_applicable', 'unknown'])
const CUA_ACTION_EVIDENCE_KINDS = new Set(['value_readback', 'window_change'])
const CUA_ACTION_ESCALATION_TARGETS = new Set(['pixel', 'foreground', 'page', 'session'])
const CUA_ACTION_ESCALATION_REASONS = new Set([
  'route_unavailable',
  'delivery_failed',
  'effect_unconfirmed',
  'suspected_noop',
  'permission_required'
])
const CUA_VERIFICATION_STATUSES = new Set(['satisfied', 'unsatisfied', 'unknown'])
const CUA_VERIFICATION_UNKNOWN_REASONS = new Set([
  'invalid_predicate',
  'unsupported_predicate',
  'untrusted_source',
  'multi_match',
  'target_missing',
  'observation_unavailable',
  'stability_unproven'
])
const CUA_DEGRADED_REASON_CODES = [
  'ax_tree_empty',
  'ax_window_unresolved',
  'msaa_fallback_partial',
  'x11_property_fallback_partial',
  'atspi_tree_empty'
]
const CUA_WINDOW_ESCALATION_TARGETS = new Set(['px', 'foreground'])

const CUA_REFUSAL_CODE_PATTERN = /^[a-z][a-z0-9_]{0,127}$/
// Lexical trust-boundary checks for cua-driver-contract 0.6.0. Callers still treat both handles
// as opaque and never derive, increment, or synthesize them.
const CUA_SNAPSHOT_ID_PATTERN = /^s[0-9a-f]{8}$/
const CUA_ELEMENT_TOKEN_PATTERN = /^s[0-9a-f]{8}:[0-9]+$/
const CUA_MAX_PROJECTED_ELEMENT_TOKENS = 256
const CUA_MAX_PROJECTED_ELEMENT_TOKEN_CHARS = 256
const CUA_MAX_ACTION_EVIDENCE_ITEMS = 16
const CUA_MAX_VERIFICATION_PREDICATES = 8
const CUA_MAX_OBSERVED_JSON_CHARS = 2000
const UINT32_MAX = 0xffffffff

const CUA_INVALID_ACTION_RESULT_PROJECTION = [
  '## CUA contract validation',
  'result="invalid_action_result"',
  'Do not infer action success; inspect fresh state or report the runtime contract failure.'
].join('\n')

const CUA_INVALID_VERIFICATION_RESULT_PROJECTION = [
  '## CUA contract validation',
  'result="invalid_verify_state_result"',
  'Do not treat the requested postcondition as verified; inspect fresh state or report the runtime contract failure.'
].join('\n')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

const readClosedString = (value: unknown, allowed: Set<string>): string | undefined =>
  typeof value === 'string' && allowed.has(value) ? value : undefined

const readNonNegativeSafeInteger = (value: unknown, maximum = Number.MAX_SAFE_INTEGER) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : undefined

const readDegradedReasonCode = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  return CUA_DEGRADED_REASON_CODES.find((code) => value === code || value.startsWith(`${code}:`))
}

export function normalizeCuaToolArguments(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (!CUA_SNAPSHOT_TARGET_TOOLS.has(toolName)) {
    return args
  }

  const elementToken = args.element_token
  if (typeof elementToken !== 'string' || elementToken.trim()) {
    return args
  }

  // CUA declares an optional unconstrained string, but its resolver rejects "" and requires every
  // additional target field to agree with a non-empty token. Keep this compatibility shim local to
  // CUA until the upstream schema rejects empty tokens and providers stop zero-filling them.
  const normalized = { ...args }
  delete normalized.element_token
  return normalized
}

export function validateCuaSnapshotTargetArguments(
  toolName: string,
  args: Record<string, unknown>
): string | undefined {
  if (!CUA_SNAPSHOT_TARGET_TOOLS.has(toolName) || args.element_index === undefined) {
    return undefined
  }

  if (readNonEmptyString(args.element_token) || readNonEmptyString(args.snapshot_id)) {
    return undefined
  }

  return [
    'snapshot_id_required:',
    `${toolName} cannot use a bare element_index; pass element_token or element_index with`,
    'snapshot_id from the same latest get_window_state result'
  ].join(' ')
}

export function buildCuaWindowStateProjection(
  toolName: string,
  structuredContent: unknown
): string | undefined {
  if (toolName !== 'get_window_state' || !isRecord(structuredContent)) {
    return undefined
  }

  const rawSnapshotId = readNonEmptyString(structuredContent.snapshot_id)
  const snapshotId =
    rawSnapshotId && CUA_SNAPSHOT_ID_PATTERN.test(rawSnapshotId) ? rawSnapshotId : undefined
  const tokenByIndex = new Map<number, string>()
  let tokenProjectionTruncated = false
  if (Array.isArray(structuredContent.elements)) {
    for (const element of structuredContent.elements) {
      if (!isRecord(element)) {
        continue
      }
      const index = element.element_index
      const token = readNonEmptyString(element.element_token)
      if (
        typeof index === 'number' &&
        Number.isSafeInteger(index) &&
        index >= 0 &&
        token &&
        !tokenByIndex.has(index)
      ) {
        if (
          !snapshotId ||
          token.length > CUA_MAX_PROJECTED_ELEMENT_TOKEN_CHARS ||
          !CUA_ELEMENT_TOKEN_PATTERN.test(token) ||
          token !== `${snapshotId}:${index}`
        ) {
          tokenProjectionTruncated = true
          continue
        }
        if (tokenByIndex.size >= CUA_MAX_PROJECTED_ELEMENT_TOKENS) {
          tokenProjectionTruncated = true
          break
        }
        tokenByIndex.set(index, token)
      }
    }
  }

  const degraded = structuredContent.degraded === true
  const degradedReasonCode = readDegradedReasonCode(structuredContent.degraded_reason)
  const escalationRecommendation = isRecord(structuredContent.escalation)
    ? readClosedString(structuredContent.escalation.recommended, CUA_WINDOW_ESCALATION_TARGETS)
    : undefined

  if (
    !snapshotId &&
    tokenByIndex.size === 0 &&
    !degraded &&
    !degradedReasonCode &&
    !escalationRecommendation
  ) {
    return undefined
  }

  const lines = [
    '## CUA structured handles',
    'Use only handles from this latest snapshot: prefer a non-empty element_token, or pass both its element_index and this snapshot_id.'
  ]
  if (snapshotId) {
    lines.push(`snapshot_id=${JSON.stringify(snapshotId)}`)
  }
  if (tokenByIndex.size > 0) {
    lines.push('element_tokens (element_index=element_token):')
    for (const [index, token] of [...tokenByIndex.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push(`${index}=${JSON.stringify(token)}`)
    }
  }
  if (tokenProjectionTruncated && (snapshotId || tokenByIndex.size > 0)) {
    lines.push('element_tokens.truncated=true')
    if (snapshotId) {
      lines.push('For an unlisted element, pass its element_index with this snapshot_id.')
    }
  }
  if (degraded) {
    lines.push('degraded=true')
  }
  if (degradedReasonCode) {
    lines.push(`degraded_reason.code=${JSON.stringify(degradedReasonCode)}`)
  }
  if (escalationRecommendation) {
    lines.push(`escalation.recommended=${JSON.stringify(escalationRecommendation)}`)
  }
  return lines.join('\n')
}

export function buildCuaActionResultProjection(
  toolName: string,
  structuredContent: unknown
): string | undefined {
  if (!CUA_ACTION_RESULT_TOOLS.has(toolName) || !isRecord(structuredContent)) {
    return undefined
  }

  const effect = readClosedString(structuredContent.effect, CUA_ACTION_EFFECTS)
  const route = readClosedString(structuredContent.route, CUA_ACTION_ROUTES)
  if (!effect || !route) {
    return undefined
  }

  const lines = [
    '## CUA action result',
    `effect=${JSON.stringify(effect)}`,
    `route=${JSON.stringify(route)}`
  ]

  const delivery = structuredContent.delivery
  let deliveredCount: number | undefined
  if (delivery !== undefined && delivery !== null) {
    if (!isRecord(delivery)) {
      return undefined
    }
    const mode = readClosedString(delivery.mode, CUA_ACTION_DELIVERY_MODES)
    if (!mode) {
      return undefined
    }
    lines.push(`delivery.mode=${JSON.stringify(mode)}`)
    if (delivery.delivered_count !== undefined) {
      deliveredCount = readNonNegativeSafeInteger(delivery.delivered_count, UINT32_MAX)
      if (deliveredCount === undefined) {
        return undefined
      }
      lines.push(`delivery.delivered_count=${deliveredCount}`)
    }
  }

  const evidence = structuredContent.evidence
  let evidenceCount: number | undefined
  if (evidence !== undefined && evidence !== null) {
    if (!Array.isArray(evidence) || evidence.length > CUA_MAX_ACTION_EVIDENCE_ITEMS) {
      return undefined
    }
    const kinds = new Set<string>()
    for (const item of evidence) {
      if (!isRecord(item)) {
        return undefined
      }
      const kind = readClosedString(item.kind, CUA_ACTION_EVIDENCE_KINDS)
      if (!kind) {
        return undefined
      }
      kinds.add(kind)
    }
    evidenceCount = evidence.length
    lines.push(`evidence=${JSON.stringify([...kinds].sort())}`)
  }

  if (
    (effect === 'confirmed' && (!evidenceCount || evidenceCount < 1)) ||
    (effect === 'partial' && deliveredCount === undefined) ||
    (effect === 'refused' && (delivery != null || evidence != null))
  ) {
    return undefined
  }

  const escalation = structuredContent.escalation
  if (escalation !== undefined && escalation !== null) {
    if (!isRecord(escalation)) {
      return undefined
    }
    const target = readClosedString(escalation.target, CUA_ACTION_ESCALATION_TARGETS)
    const reason = readClosedString(escalation.reason, CUA_ACTION_ESCALATION_REASONS)
    if (!target || !reason) {
      return undefined
    }
    lines.push(`escalation.target=${JSON.stringify(target)}`)
    lines.push(`escalation.reason=${JSON.stringify(reason)}`)
  }

  lines.push('Action delivery is not task completion; verify the requested postcondition.')
  return lines.join('\n')
}

export function buildCuaVerifyStateProjection(
  toolName: string,
  structuredContent: unknown
): string | undefined {
  if (toolName !== 'verify_state' || !isRecord(structuredContent)) {
    return undefined
  }

  const status = readClosedString(structuredContent.status, CUA_VERIFICATION_STATUSES)
  const elapsedMs = readNonNegativeSafeInteger(structuredContent.elapsed_ms)
  const samples = readNonNegativeSafeInteger(structuredContent.samples)
  if (
    !status ||
    typeof structuredContent.stable !== 'boolean' ||
    elapsedMs === undefined ||
    samples === undefined ||
    !Array.isArray(structuredContent.predicates) ||
    structuredContent.predicates.length === 0 ||
    structuredContent.predicates.length > CUA_MAX_VERIFICATION_PREDICATES
  ) {
    return undefined
  }

  const predicateLines: string[] = []
  for (const [position, predicate] of structuredContent.predicates.entries()) {
    if (!isRecord(predicate)) {
      return undefined
    }
    const index = readNonNegativeSafeInteger(predicate.index)
    const predicateStatus = readClosedString(predicate.status, CUA_VERIFICATION_STATUSES)
    if (index !== position || !predicateStatus || predicate.unknown_reason === undefined) {
      return undefined
    }
    predicateLines.push(`${index}.status=${JSON.stringify(predicateStatus)}`)
    if (predicate.unknown_reason !== null) {
      const unknownReason = readClosedString(
        predicate.unknown_reason,
        CUA_VERIFICATION_UNKNOWN_REASONS
      )
      if (!unknownReason) {
        return undefined
      }
      predicateLines.push(`${index}.unknown_reason=${JSON.stringify(unknownReason)}`)
    }
    if (
      predicate.observed_json === undefined ||
      (predicate.observed_json !== null &&
        (typeof predicate.observed_json !== 'string' ||
          predicate.observed_json.length > CUA_MAX_OBSERVED_JSON_CHARS))
    ) {
      return undefined
    }
  }

  const lines = [
    '## CUA verification result',
    `status=${JSON.stringify(status)}`,
    `stable=${structuredContent.stable}`,
    `elapsed_ms=${elapsedMs}`,
    `samples=${samples}`,
    'Only status="satisfied" with stable=true is success; status="unknown" is not success.'
  ]
  if (predicateLines.length > 0) {
    lines.push('predicates:')
    lines.push(...predicateLines)
  }
  return lines.join('\n')
}

export function buildCuaRefusalProjection(structuredContent: unknown): string | undefined {
  if (!isRecord(structuredContent) || !isRecord(structuredContent.refusal)) {
    return undefined
  }

  const code = structuredContent.refusal.code
  if (typeof code !== 'string' || !CUA_REFUSAL_CODE_PATTERN.test(code)) {
    return undefined
  }

  return `## CUA structured refusal\nrefusal.code=${JSON.stringify(code)}`
}

export function buildCuaBrowserChromeCoverageProjection(
  toolName: string,
  structuredContent: unknown
): string | undefined {
  if (toolName !== 'get_window_state' || !isRecord(structuredContent)) {
    return undefined
  }

  const captureCoverage = structuredContent.capture_coverage
  if (!isRecord(captureCoverage)) {
    return undefined
  }

  const browserChrome = captureCoverage.browser_chrome
  const recovery = captureCoverage.recovery
  if (!isRecord(browserChrome) || !isRecord(recovery) || !isRecord(recovery.escalate)) {
    return undefined
  }

  if (
    browserChrome.status !== 'not_observable_in_window_scope' ||
    recovery.when !== 'verified_window_action_ineffective' ||
    recovery.escalate.tool !== 'escalate_session' ||
    recovery.escalate.reason !== 'foreground_ineffective' ||
    recovery.inspect !== 'get_desktop_state' ||
    recovery.act_scope !== 'desktop' ||
    recovery.verify !== 'get_desktop_state'
  ) {
    return undefined
  }

  return [
    '## CUA browser chrome coverage',
    'browser_chrome.status="not_observable_in_window_scope"',
    'recovery.when="verified_window_action_ineffective"',
    'recovery.escalate.tool="escalate_session"',
    'recovery.escalate.reason="foreground_ineffective"',
    'recovery.inspect="get_desktop_state"',
    'recovery.act_scope="desktop"',
    'recovery.verify="get_desktop_state"'
  ].join('\n')
}

export function appendCuaStructuredProjection(
  content: string | MCPContentItem[],
  projection: string | undefined
): string | MCPContentItem[] {
  if (!projection) {
    return content
  }
  if (typeof content === 'string') {
    return content ? `${content}\n\n${projection}` : projection
  }
  return [...content, { type: 'text', text: projection }]
}

export function appendCuaResultProjections(
  content: string | MCPContentItem[],
  toolName: string,
  structuredContent: unknown,
  isError = false
): string | MCPContentItem[] {
  let projected = content
  if (!isError) {
    projected = appendCuaStructuredProjection(
      projected,
      buildCuaWindowStateProjection(toolName, structuredContent)
    )
    projected = appendCuaStructuredProjection(
      projected,
      buildCuaBrowserChromeCoverageProjection(toolName, structuredContent)
    )

    const actionResult = buildCuaActionResultProjection(toolName, structuredContent)
    projected = appendCuaStructuredProjection(
      projected,
      actionResult ??
        (CUA_ACTION_RESULT_TOOLS.has(toolName) ? CUA_INVALID_ACTION_RESULT_PROJECTION : undefined)
    )

    const verificationResult = buildCuaVerifyStateProjection(toolName, structuredContent)
    projected = appendCuaStructuredProjection(
      projected,
      verificationResult ??
        (toolName === 'verify_state' ? CUA_INVALID_VERIFICATION_RESULT_PROJECTION : undefined)
    )
  }

  return appendCuaStructuredProjection(projected, buildCuaRefusalProjection(structuredContent))
}
