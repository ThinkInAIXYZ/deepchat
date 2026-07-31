import type { WorkflowSourceOutlineNode } from '@shared/workflow/outline'

export function formatWorkflowOutlineNode(node: WorkflowSourceOutlineNode): string {
  const kind = node.kind === 'map_limit' ? 'mapLimit' : node.kind
  const identity = node.label ?? node.key ?? '?'
  const dimensions: string[] = []
  if (node.itemCount !== null) {
    dimensions.push(`×${node.itemCount}`)
  }
  if (node.stageCount !== null) {
    dimensions.push(`↦${node.stageCount}`)
  }
  if (node.concurrency !== null) {
    dimensions.push(`≤${node.concurrency}`)
  }
  return [kind, identity, ...dimensions].join(' · ')
}
