import type { IConversationExporter } from './interface'
import {
  nowledgeMemGetConfigRoute,
  nowledgeMemTestConnectionRoute,
  nowledgeMemUpdateConfigRoute
} from '@shared/contracts/routes'
import { createRouteMap, type DeepchatRouteMap } from '@/routes/routeRegistry'

export function createExporterRoutes(exporter: IConversationExporter): DeepchatRouteMap {
  return createRouteMap([
    [
      nowledgeMemGetConfigRoute.name,
      async (rawInput) => {
        nowledgeMemGetConfigRoute.input.parse(rawInput)
        return nowledgeMemGetConfigRoute.output.parse({ config: exporter.getNowledgeMemConfig() })
      }
    ],
    [
      nowledgeMemUpdateConfigRoute.name,
      async (rawInput) => {
        const input = nowledgeMemUpdateConfigRoute.input.parse(rawInput)
        await exporter.updateNowledgeMemConfig(input.config)
        return nowledgeMemUpdateConfigRoute.output.parse({
          config: exporter.getNowledgeMemConfig()
        })
      }
    ],
    [
      nowledgeMemTestConnectionRoute.name,
      async (rawInput) => {
        nowledgeMemTestConnectionRoute.input.parse(rawInput)
        return nowledgeMemTestConnectionRoute.output.parse({
          result: await exporter.testNowledgeMemConnection()
        })
      }
    ]
  ])
}
