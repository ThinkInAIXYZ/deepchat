import { useQuery, type EntryKey, type UseQueryOptions } from '@pinia/colada'
import type { MaybeRefOrGetter } from 'vue'
import { toValue } from 'vue'

type QueryOptionKeys = 'enabled' | 'staleTime' | 'gcTime'

type QueryFunction<TArgs extends unknown[], TResult> = (
  ...args: TArgs
) => Promise<TResult> | TResult

export interface UseIpcQueryOptions<TArgs extends unknown[], TResult> extends Pick<
  UseQueryOptions<Awaited<TResult>>,
  QueryOptionKeys
> {
  key: () => EntryKey
  query: QueryFunction<TArgs, TResult>
  args?: MaybeRefOrGetter<TArgs>
}

export function useIpcQuery<TArgs extends unknown[], TResult>(
  options: UseIpcQueryOptions<TArgs, TResult>
) {
  return useQuery({
    key: options.key,
    enabled: options.enabled,
    staleTime: options.staleTime,
    gcTime: options.gcTime,
    query: async () => {
      const args = options.args ? toValue(options.args) : ([] as unknown as TArgs)
      return await options.query(...args)
    }
  })
}
