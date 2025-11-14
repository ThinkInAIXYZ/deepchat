import { useMutation, useQueryCache, type EntryKey } from '@pinia/colada'
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

export interface UseIpcMutationOptions<
  TName extends PresenterName,
  TMethod extends PresenterMethod<TName>
> {
  presenter: TName
  method: TMethod
  invalidateQueries?: (
    result: Awaited<ReturnType<PresenterMethodFn<TName, TMethod>>>,
    variables: Parameters<PresenterMethodFn<TName, TMethod>>
  ) => EntryKey[] | EntryKey[][]
  onSuccess?: (
    result: Awaited<ReturnType<PresenterMethodFn<TName, TMethod>>>,
    variables: Parameters<PresenterMethodFn<TName, TMethod>>
  ) => void | Promise<void>
  onError?: (
    error: Error,
    variables: Parameters<PresenterMethodFn<TName, TMethod>>
  ) => void | Promise<void>
  onSettled?: (
    result: Awaited<ReturnType<PresenterMethodFn<TName, TMethod>>> | undefined,
    error: Error | null,
    variables: Parameters<PresenterMethodFn<TName, TMethod>>,
    context: any
  ) => void | Promise<void>
}

export function useIpcMutation<TName extends PresenterName, TMethod extends PresenterMethod<TName>>(
  options: UseIpcMutationOptions<TName, TMethod>
) {
  const presenter = usePresenter(options.presenter)
  const invoke = presenter[options.method] as PresenterMethodFn<TName, TMethod>
  const queryCache = useQueryCache()

  return useMutation({
    mutation: async (vars: Parameters<PresenterMethodFn<TName, TMethod>>) => {
      return await invoke(...vars)
    },
    async onSettled(result, error, variables, context) {
      // Call user-provided onSettled if exists
      if (options.onSettled) {
        await options.onSettled(
          result as Awaited<ReturnType<PresenterMethodFn<TName, TMethod>>> | undefined,
          error || null,
          variables,
          context
        )
      }
    },
    async onSuccess(result, variables, _context) {
      // Invalidate queries if specified (only on success)
      if (options.invalidateQueries && result !== undefined) {
        const keys = options.invalidateQueries(
          result as Awaited<ReturnType<PresenterMethodFn<TName, TMethod>>>,
          variables
        )
        const keysArray = Array.isArray(keys[0]) ? keys : ([keys] as EntryKey[][])

        for (const key of keysArray) {
          await queryCache.invalidateQueries({ key, exact: false })
        }
      }

      if (options.onSuccess && result !== undefined) {
        await options.onSuccess(
          result as Awaited<ReturnType<PresenterMethodFn<TName, TMethod>>>,
          variables
        )
      }
    },
    async onError(error, variables, _context) {
      if (options.onError) {
        await options.onError(error, variables)
      }
    }
  })
}
