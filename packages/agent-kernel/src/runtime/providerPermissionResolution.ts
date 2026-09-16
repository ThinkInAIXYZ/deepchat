export type ProviderPermissionResolution =
  | { status: 'resolved' }
  | { status: 'stale'; error: unknown }

export async function resolveProviderPermissionSafely(
  task: () => Promise<void>
): Promise<ProviderPermissionResolution> {
  try {
    await task()
    return { status: 'resolved' }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : undefined
    if (!message?.startsWith('Unknown ACP permission request:')) {
      throw error
    }
    return { status: 'stale', error }
  }
}
