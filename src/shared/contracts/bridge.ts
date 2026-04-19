import type { DeepchatEventName, DeepchatEventPayload } from './events'
import type { DeepchatRouteInput, DeepchatRouteName, DeepchatRouteOutput } from './routes'

export interface DeepchatBridge {
  invoke<T extends DeepchatRouteName>(
    routeName: T,
    input: DeepchatRouteInput<T>
  ): Promise<DeepchatRouteOutput<T>>
  on<T extends DeepchatEventName>(
    eventName: T,
    listener: (payload: DeepchatEventPayload<T>) => void
  ): () => void
}
