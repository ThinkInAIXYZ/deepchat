export type McpAppDisplayMode = 'inline' | 'fullscreen' | 'pip'

type NonInlineOwner = {
  instanceId: string
  forceInline(): void
}

let owner: NonInlineOwner | null = null

export const claimMcpAppNonInlineDisplay = (next: NonInlineOwner): void => {
  if (owner && owner.instanceId !== next.instanceId) {
    owner.forceInline()
  }
  owner = next
}

export const releaseMcpAppNonInlineDisplay = (instanceId: string): void => {
  if (owner?.instanceId === instanceId) {
    owner = null
  }
}
