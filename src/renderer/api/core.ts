import type { DeepchatBridge } from '@shared/contracts/bridge'
import type {
  DeepchatRouteInput,
  DeepchatRouteName,
  DeepchatRouteOutput
} from '@shared/contracts/routes'

export function getDeepchatBridge(): DeepchatBridge {
  if (!window.deepchat) {
    throw new Error('window.deepchat is not available')
  }

  return window.deepchat
}

export async function invokeDeepchatRoute<T extends DeepchatRouteName>(
  routeName: T,
  input: DeepchatRouteInput<T>
): Promise<DeepchatRouteOutput<T>> {
  return await getDeepchatBridge().invoke(routeName, input)
}
