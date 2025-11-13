import { useQuery, type EntryKey, type UseQueryOptions } from '@pinia/colada'
import type { MaybeRefOrGetter } from 'vue'
import { toValue } from 'vue'
import type { IPresenter } from '@shared/presenter'
import { usePresenter } from './usePresenter'

type PresenterName = keyof IPresenter
type PresenterMethod<TName extends PresenterName> = keyof IPresenter[TName]
type PresenterMethodFn<
  TName extends PresenterName,
  TMethod extends PresenterMethod<TName>
> = IPresenter[TName][TMethod] extends (...args: infer TArgs) => infer TResult
  ? (...args: TArgs) => TResult
  : never

type QueryOptionKeys = 'enabled' | 'staleTime' | 'gcTime'

export interface UseIpcQueryOptions<
  TName extends PresenterName,
  TMethod extends PresenterMethod<TName>
> extends Pick<
    UseQueryOptions<Awaited<ReturnType<PresenterMethodFn<TName, TMethod>>>>,
    QueryOptionKeys
  > {
  key: () => EntryKey
  presenter: TName
  method: TMethod
  args?: MaybeRefOrGetter<Parameters<PresenterMethodFn<TName, TMethod>>>
}

export function useIpcQuery<TName extends PresenterName, TMethod extends PresenterMethod<TName>>(
  options: UseIpcQueryOptions<TName, TMethod>
) {
  const presenter = usePresenter(options.presenter)
  const invoke = presenter[options.method] as PresenterMethodFn<TName, TMethod>

  return useQuery({
    key: options.key,
    enabled: options.enabled,
    staleTime: options.staleTime,
    gcTime: options.gcTime,
    query: async () => {
      const args = options.args ? toValue(options.args) : []
      return await invoke(...(args as Parameters<PresenterMethodFn<TName, TMethod>>))
    }
  })
}
