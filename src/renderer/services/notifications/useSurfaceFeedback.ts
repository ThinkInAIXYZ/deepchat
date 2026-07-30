import {
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  readonly,
  shallowRef,
  type DeepReadonly,
  type ShallowRef
} from 'vue'
import type {
  SurfaceFeedbackController,
  SurfaceFeedbackSnapshot
} from './surfaceFeedbackController'

export type SurfaceFeedbackBinding = Readonly<{
  snapshot: DeepReadonly<ShallowRef<SurfaceFeedbackSnapshot>>
  setActive(active: boolean): void
}>

export const useSurfaceFeedback = (
  controller: SurfaceFeedbackController
): SurfaceFeedbackBinding => {
  const snapshot = shallowRef(controller.getSnapshot())
  const stop = controller.subscribe((next) => {
    snapshot.value = next
  })
  const lease = controller.acquireLease()

  onActivated(() => {
    lease.setActive(true)
  })
  onDeactivated(() => {
    lease.setActive(false)
  })
  onBeforeUnmount(() => {
    stop()
    controller.dispose()
  })

  return Object.freeze({
    snapshot: readonly(snapshot),
    setActive: lease.setActive
  })
}
