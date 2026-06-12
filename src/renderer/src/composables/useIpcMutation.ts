import { useMutation, useQueryCache, type EntryKey } from '@pinia/colada'

type MutationFunction<TArgs extends unknown[], TResult> = (
  ...args: TArgs
) => Promise<TResult> | TResult

export interface UseIpcMutationOptions<TArgs extends unknown[], TResult> {
  mutation: MutationFunction<TArgs, TResult>
  invalidateQueries?: (
    result: Awaited<TResult> | undefined,
    variables: TArgs
  ) => EntryKey[] | EntryKey[][]
  onSuccess?: (result: Awaited<TResult> | undefined, variables: TArgs) => void | Promise<void>
  onError?: (error: Error, variables: TArgs) => void | Promise<void>
  onSettled?: (
    result: Awaited<TResult> | undefined,
    error: Error | null,
    variables: TArgs,
    context: any
  ) => void | Promise<void>
}

export function useIpcMutation<TArgs extends unknown[], TResult>(
  options: UseIpcMutationOptions<TArgs, TResult>
) {
  const queryCache = useQueryCache()

  return useMutation({
    mutation: async (vars: TArgs) => {
      return await options.mutation(...vars)
    },
    async onSettled(result, error, variables, context) {
      if (options.onSettled) {
        await options.onSettled(
          result as Awaited<TResult> | undefined,
          error || null,
          variables,
          context
        )
      }
    },
    async onSuccess(result, variables, _context) {
      const resolvedResult = result as Awaited<TResult> | undefined

      if (options.invalidateQueries) {
        const keys = options.invalidateQueries(resolvedResult, variables)
        const keysArray = Array.isArray(keys[0]) ? keys : ([keys] as EntryKey[][])

        for (const key of keysArray) {
          await queryCache.invalidateQueries({ key, exact: false })
        }
      }

      if (options.onSuccess) {
        await options.onSuccess(resolvedResult, variables)
      }
    },
    async onError(error, variables, _context) {
      if (options.onError) {
        await options.onError(error, variables)
      }
    }
  })
}
