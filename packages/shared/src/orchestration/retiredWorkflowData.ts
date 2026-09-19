export function isRetiredWorkflowResultMessageMetadata(value: string): boolean {
  try {
    const metadata = JSON.parse(value) as { messageType?: unknown }
    return metadata?.messageType === 'workflow_result'
  } catch {
    return false
  }
}
