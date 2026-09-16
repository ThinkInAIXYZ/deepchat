import type { CommandShellProfile, ResolvedCommandShell } from '../shared/commandShell.js'

/**
 * Command shell resolution surface the built-in kernel needs. The host shell service implements
 * it; kernel modules receive this port instead of importing the host module.
 */
export interface CommandShellResolutionPort {
  resolveForTurn(): Promise<ResolvedCommandShell>
  resolveProfile(profile: CommandShellProfile): Promise<ResolvedCommandShell>
}
