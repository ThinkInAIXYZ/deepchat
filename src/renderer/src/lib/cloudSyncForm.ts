import type { CloudSyncConfigInput } from '@shared/presenter'

export const CLOUD_SYNC_DEFAULTS = {
  region: 'auto',
  prefix: 'deepchat-backups'
} as const

export type CloudSyncProviderMode = 'r2' | 'custom'

export type CloudSyncForm = {
  endpoint: string
  bucket: string
  region: string
  prefix: string
  accessKeyId: string
  secretAccessKey: string
}

export type CloudSyncValidationError = 'r2SecretLooksLikeApiToken'

export type CloudSyncValidationWarning = 'r2AccessKeyLooksLikeAccountId'

export type CloudSyncValidationOptions = {
  providerMode: CloudSyncProviderMode
  hasStoredSecret: boolean
}

export type CloudSyncValidationResult = {
  canSave: boolean
  errors: CloudSyncValidationError[]
  warnings: CloudSyncValidationWarning[]
}

export const normalizeCloudSyncEndpoint = (endpoint: string): string => {
  return endpoint.trim().replace(/\/+$/, '')
}

export const normalizeCloudSyncPrefix = (prefix: string): string => {
  return prefix.trim().replace(/^\/+|\/+$/g, '')
}

export const extractR2AccountId = (endpoint: string): string => {
  const normalizedEndpoint = normalizeCloudSyncEndpoint(endpoint)
  if (!normalizedEndpoint) {
    return ''
  }

  const host = (() => {
    try {
      const url = new URL(
        normalizedEndpoint.includes('://') ? normalizedEndpoint : `https://${normalizedEndpoint}`
      )
      return url.hostname
    } catch {
      return normalizedEndpoint.split('/')[0]?.split(':')[0] ?? ''
    }
  })()

  const match = host.match(/^([a-z0-9]+)(?:\.[a-z0-9-]+)?\.r2\.cloudflarestorage\.com$/i)
  return match?.[1] ?? ''
}

export const isCloudflareApiTokenSecret = (secretAccessKey: string): boolean => {
  return secretAccessKey.trim().startsWith('cfat_')
}

export const createDefaultCloudSyncForm = (): CloudSyncForm => ({
  endpoint: '',
  bucket: '',
  region: CLOUD_SYNC_DEFAULTS.region,
  prefix: CLOUD_SYNC_DEFAULTS.prefix,
  accessKeyId: '',
  secretAccessKey: ''
})

export const validateCloudSyncForm = (
  form: CloudSyncForm,
  options: CloudSyncValidationOptions
): CloudSyncValidationResult => {
  const endpoint = normalizeCloudSyncEndpoint(form.endpoint)
  const bucket = form.bucket.trim()
  const region = form.region.trim() || CLOUD_SYNC_DEFAULTS.region
  const accessKeyId = form.accessKeyId.trim()
  const secretAccessKey = form.secretAccessKey.trim()
  const errors: CloudSyncValidationError[] = []
  const warnings: CloudSyncValidationWarning[] = []

  if (options.providerMode === 'r2') {
    const r2AccountId = extractR2AccountId(endpoint)
    if (r2AccountId && accessKeyId && r2AccountId.toLowerCase() === accessKeyId.toLowerCase()) {
      warnings.push('r2AccessKeyLooksLikeAccountId')
    }

    if (isCloudflareApiTokenSecret(secretAccessKey)) {
      errors.push('r2SecretLooksLikeApiToken')
    }
  }

  return {
    canSave:
      Boolean(endpoint) &&
      Boolean(bucket) &&
      Boolean(region) &&
      Boolean(accessKeyId) &&
      (Boolean(secretAccessKey) || options.hasStoredSecret) &&
      errors.length === 0,
    errors,
    warnings
  }
}

export const buildCloudSyncConfigInput = (form: CloudSyncForm): CloudSyncConfigInput => {
  const secretAccessKey = form.secretAccessKey.trim()
  const input: CloudSyncConfigInput = {
    endpoint: normalizeCloudSyncEndpoint(form.endpoint),
    bucket: form.bucket.trim(),
    region: form.region.trim() || CLOUD_SYNC_DEFAULTS.region,
    prefix: normalizeCloudSyncPrefix(form.prefix),
    accessKeyId: form.accessKeyId.trim()
  }

  if (secretAccessKey) {
    input.secretAccessKey = secretAccessKey
  }

  return input
}
