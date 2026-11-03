import { definePlugin } from '@arcships/rutis'
import { HookService } from '@/hook'

export interface HooksCapability {
  open(...ports: ConstructorParameters<typeof HookService>): HookService
  retire(): Promise<void>
}

export default definePlugin({
  name: 'deepchat-hooks',
  provides: { deepchatHooksCapability: { open: 'sync', retire: 'async' } },
  apply(ctx) {
    let service: HookService | undefined
    let retirement: Promise<void> | undefined
    const hooks: HooksCapability = {
      open(...ports) {
        if (ctx.signal.aborted || retirement || service)
          throw new Error('Hooks capability cannot reopen')
        return (service = new HookService(...ports))
      },
      retire() {
        return (retirement ??= service?.dispose() ?? Promise.resolve())
      }
    }
    ctx.signal.addEventListener('abort', () => void hooks.retire().catch(() => {}), { once: true })
    ctx.effect(() => hooks.retire())
    ctx.provide('deepchatHooksCapability', hooks)
  }
})
