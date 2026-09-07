import type { Router } from 'vue-router'
import type { SettingsLeaveGuard } from './settingsLeaveGuard'

type SettingsRouteGuardRouter = Pick<Router, 'beforeEach'>
type SettingsLeaveRequest = Pick<SettingsLeaveGuard, 'requestLeave'>

export function installSettingsRouteLeaveGuard(
  router: SettingsRouteGuardRouter,
  leaveGuard: SettingsLeaveRequest
): () => void {
  return router.beforeEach(() => leaveGuard.requestLeave())
}
