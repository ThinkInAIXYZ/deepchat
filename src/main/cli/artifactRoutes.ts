import {
  artifactsDeleteRoute,
  artifactsDescribeRoute,
  artifactsReadRoute
} from '@shared/contracts/routes'
import {
  createRouteMap,
  type CliRouteCaller,
  type DeepchatRouteMap,
  type RouteCaller
} from '@/routes/routeRegistry'
import { ArtifactSpool } from './artifactSpool'
import { CliRequestError } from './errors'

function requireCliCaller(caller: RouteCaller): CliRouteCaller {
  if (caller.kind !== 'cli') {
    throw new CliRequestError('permission_denied', 'Artifact routes require a CLI caller', {
      httpStatus: 403
    })
  }
  return caller
}

export function createArtifactRoutes(artifactSpool: ArtifactSpool): DeepchatRouteMap {
  return createRouteMap([
    [
      artifactsDescribeRoute.name,
      async (rawInput, context) => {
        const input = artifactsDescribeRoute.input.parse(rawInput)
        const caller = requireCliCaller(context.caller)
        return artifactsDescribeRoute.output.parse({
          artifact: await artifactSpool.describe(input.id, caller)
        })
      }
    ],
    // The RPC route is a metadata preflight; bytes use the streamed download endpoint.
    [
      artifactsReadRoute.name,
      async (rawInput, context) => {
        const input = artifactsReadRoute.input.parse(rawInput)
        const caller = requireCliCaller(context.caller)
        return artifactsReadRoute.output.parse({
          artifact: await artifactSpool.describe(input.id, caller)
        })
      }
    ],
    [
      artifactsDeleteRoute.name,
      async (rawInput, context) => {
        const input = artifactsDeleteRoute.input.parse(rawInput)
        const caller = requireCliCaller(context.caller)
        if (caller.principal !== 'human') {
          throw new CliRequestError('permission_denied', 'Agent callers cannot delete artifacts', {
            httpStatus: 403
          })
        }
        await artifactSpool.delete(input.id, caller)
        return artifactsDeleteRoute.output.parse({ deleted: true })
      }
    ]
  ])
}
