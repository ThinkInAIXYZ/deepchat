import {
  acpTerminalInputRoute,
  acpTerminalKillRoute,
  type DeepchatRouteName
} from '@shared/contracts/routes'
import { killTerminal, writeToTerminal } from './launch/acpInitHelper'

export function createAcpRoutes() {
  const routes = new Map<DeepchatRouteName, (rawInput: unknown) => Promise<unknown>>()
  routes.set(acpTerminalInputRoute.name, async (rawInput) => {
    const input = acpTerminalInputRoute.input.parse(rawInput)
    writeToTerminal(input.data)
    return acpTerminalInputRoute.output.parse({ sent: true })
  })
  routes.set(acpTerminalKillRoute.name, async (rawInput) => {
    acpTerminalKillRoute.input.parse(rawInput)
    killTerminal()
    return acpTerminalKillRoute.output.parse({ killed: true })
  })
  return routes
}
