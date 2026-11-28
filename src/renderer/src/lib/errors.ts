import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'

export function getRouteErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const prefix = `Error invoking remote method '${DEEPCHAT_ROUTE_INVOKE_CHANNEL}': Error: `
  return message.startsWith(prefix) ? message.slice(prefix.length) : message
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /\bAbortError\b|(?:^|:\s)Aborted(?:[.:]|$)|operation was aborted/i.test(message)
}
