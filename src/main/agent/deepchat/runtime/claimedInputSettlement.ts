import type { ProcessResult } from './types'

export function shouldConsumeClaimedInput(
  status: ProcessResult['status'] | undefined,
  isSteerClaim: boolean
): boolean {
  return (
    isSteerClaim || status === 'completed' || status === 'paused' || status === 'aborted'
  )
}
