import type { NotificationRequest } from './notificationTypes'

export type NotificationRecovery = Readonly<{
  kind: 'transient' | 'actionable'
  code: string
  key: string
  scope?: string
}>

export const normalizeNotificationCode = (value: string): string => {
  const code = value.trim()
  if (!code) throw new TypeError('Notification code must not be empty')
  if (code.length > 96 || !/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)*$/.test(code)) {
    throw new TypeError('Notification code must be a stable dotted identifier')
  }
  return code
}

export const normalizeNotificationOperationId = (value: string): string => {
  const operationId = value.trim()
  if (!operationId) {
    throw new TypeError('Progress operation ID must not be empty')
  }
  return operationId
}

export const normalizeNotificationRequest = (request: NotificationRequest): NotificationRequest => {
  if (!['success', 'info', 'warning', 'error', 'actionable', 'progress'].includes(request.kind)) {
    throw new TypeError('Notification kind is invalid')
  }
  const code = normalizeNotificationCode(request.code)
  const title = request.title.trim()
  if (!title) throw new TypeError('Notification title must not be empty')
  if ('key' in request && request.key !== undefined && !request.key.trim()) {
    throw new TypeError('Notification key must not be empty')
  }
  if ('scope' in request && request.scope !== undefined && !request.scope.trim()) {
    throw new TypeError('Notification scope must not be empty')
  }
  if ('entity' in request && request.entity !== undefined && !request.entity.trim()) {
    throw new TypeError('Notification entity must not be empty')
  }
  if (request.kind === 'progress') {
    const operationId = normalizeNotificationOperationId(request.operationId)
    if (
      request.progress !== undefined &&
      (!Number.isFinite(request.progress) || request.progress < 0 || request.progress > 1)
    ) {
      throw new RangeError('Notification progress must be between 0 and 1')
    }
    return Object.freeze({
      ...request,
      code,
      title,
      operationId
    })
  }

  if (request.kind === 'actionable') {
    if (
      request.urgency !== undefined &&
      !['normal', 'high', 'critical'].includes(request.urgency)
    ) {
      throw new TypeError('Notification urgency is invalid')
    }
    if (
      request.retention !== undefined &&
      !['default', 'until-resolved'].includes(request.retention)
    ) {
      throw new TypeError('Notification retention is invalid')
    }
    const actionLabel = request.action?.label?.trim()
    if (!actionLabel || typeof request.action?.onClick !== 'function') {
      throw new TypeError('Actionable notifications require a label and callback')
    }
    const ariaLabel = request.action.ariaLabel?.trim()
    return Object.freeze({
      ...request,
      code,
      title,
      key: request.key.trim(),
      ...(request.scope ? { scope: request.scope.trim() } : {}),
      ...(request.entity ? { entity: request.entity.trim() } : {}),
      action: Object.freeze({
        ...request.action,
        label: actionLabel,
        ...(ariaLabel ? { ariaLabel } : { ariaLabel: undefined })
      })
    })
  }

  if ('key' in request && request.key !== undefined) {
    return Object.freeze({
      ...request,
      code,
      title,
      key: request.key.trim(),
      ...(request.scope ? { scope: request.scope.trim() } : {}),
      ...(request.entity ? { entity: request.entity.trim() } : {})
    })
  }

  return Object.freeze({ ...request, code, title })
}

export const resolveNotificationIdentity = (request: NotificationRequest): string | undefined => {
  if (request.kind === 'progress') {
    return `progress:${request.operationId}`
  }
  if (request.kind === 'actionable') {
    if (request.scope) {
      return `actionable-scope:${request.code}:${request.scope}`
    }
    return `actionable:${request.code}:${request.key}`
  }
  if ('scope' in request && request.scope) {
    return `transient-scope:${request.code}:${request.scope}`
  }
  if ('key' in request && request.key) {
    return `transient-key:${request.code}:${request.key}`
  }
  return undefined
}

export const resolveNotificationMemberKey = (request: NotificationRequest): string | undefined => {
  if (request.kind === 'progress' || !('scope' in request) || !request.scope) {
    return undefined
  }
  return request.key
}

export const normalizeNotificationRecovery = (
  recovery: NotificationRecovery
): Readonly<{ identity: string; key: string; scope?: string }> => {
  if (recovery.kind !== 'transient' && recovery.kind !== 'actionable') {
    throw new TypeError('Notification recovery kind is invalid')
  }
  const code = normalizeNotificationCode(recovery.code)
  const key = recovery.key.trim()
  const scope = recovery.scope?.trim()
  if (!key) throw new TypeError('Notification recovery key must not be empty')
  if (recovery.scope !== undefined && !scope) {
    throw new TypeError('Notification recovery scope must not be empty')
  }

  const identity =
    recovery.kind === 'actionable'
      ? scope
        ? `actionable-scope:${code}:${scope}`
        : `actionable:${code}:${key}`
      : scope
        ? `transient-scope:${code}:${scope}`
        : `transient-key:${code}:${key}`
  return Object.freeze({
    identity,
    key,
    ...(scope ? { scope } : {})
  })
}
