/**
 * Media Generation Parameters - Provider-Specific Configuration
 *
 * This module provides unified media generation parameters across different providers.
 * Each provider can have different parameter names, ranges, and defaults.
 */

export type MediaParamType = 'video' | 'image'

export interface ResolutionOption {
  value: string
  label: string
  width: number
  height: number
}

export interface DurationOption {
  value: number
  label: string
}

export interface MediaParamConfig {
  resolution?: {
    default: string
    options: ResolutionOption[]
  }
  duration?: {
    default: number
    min: number
    max: number
    step: number
    unit: 'seconds' | 'minutes'
  }
  cameraFixed?: {
    default: boolean
    supported: boolean
  }
  watermark?: {
    default: boolean
    supported: boolean
  }
  aspectRatio?: {
    default: string
    options: string[]
  }
}

export type ProviderMediaParamMap = Record<string, MediaParamConfig>

// Provider-specific media parameter configurations
export const PROVIDER_MEDIA_PARAMS: Record<string, ProviderMediaParamMap> = {
  doubao: {
    video: {
      resolution: {
        default: '1080x1920',
        options: [
          { value: '540x960', label: '540p (9:16)', width: 540, height: 960 },
          { value: '720x1280', label: '720p (9:16)', width: 720, height: 1280 },
          { value: '1080x1920', label: '1080p (9:16)', width: 1080, height: 1920 }
        ]
      },
      duration: {
        default: 5,
        min: 5,
        max: 10,
        step: 1,
        unit: 'seconds'
      },
      cameraFixed: {
        default: false,
        supported: true
      },
      watermark: {
        default: false,
        supported: true
      }
    },
    image: {
      resolution: {
        default: '1024x1024',
        options: [
          { value: '512x512', label: '512x512', width: 512, height: 512 },
          { value: '768x768', label: '768x768', width: 768, height: 768 },
          { value: '1024x1024', label: '1024x1024', width: 1024, height: 1024 },
          { value: '1024x1536', label: '1024x1536 (2:3)', width: 1024, height: 1536 },
          { value: '1536x1024', label: '1536x1024 (3:2)', width: 1536, height: 1024 }
        ]
      },
      watermark: {
        default: false,
        supported: true
      }
    }
  },
  // OpenAI-compatible providers (DALL-E, etc.)
  openai: {
    image: {
      resolution: {
        default: '1024x1024',
        options: [
          { value: '1024x1024', label: '1024x1024', width: 1024, height: 1024 },
          { value: '1792x1024', label: '1792x1024 (Landscape)', width: 1792, height: 1024 },
          { value: '1024x1792', label: '1024x1792 (Portrait)', width: 1024, height: 1792 }
        ]
      },
      watermark: {
        default: false,
        supported: false
      }
    }
  }
}

/**
 * Get media parameter configuration for a provider and media type
 */
export function getMediaParamConfig(
  providerId: string,
  mediaType: MediaParamType
): MediaParamConfig | undefined {
  const normalizedProviderId = providerId.toLowerCase()

  // Direct match
  if (PROVIDER_MEDIA_PARAMS[normalizedProviderId]?.[mediaType]) {
    return PROVIDER_MEDIA_PARAMS[normalizedProviderId][mediaType]
  }

  // Try to match by provider name patterns
  if (normalizedProviderId.includes('doubao') || normalizedProviderId.includes('volcengine')) {
    return PROVIDER_MEDIA_PARAMS.doubao[mediaType]
  }

  if (normalizedProviderId.includes('openai')) {
    return PROVIDER_MEDIA_PARAMS.openai[mediaType]
  }

  // Default to doubao configuration for unknown providers
  return PROVIDER_MEDIA_PARAMS.doubao[mediaType]
}

/**
 * Check if a provider supports a specific media type
 */
export function supportsMediaType(providerId: string, mediaType: MediaParamType): boolean {
  return getMediaParamConfig(providerId, mediaType) !== undefined
}

/**
 * Map generic media parameters to provider-specific API parameters
 */
export function mapToProviderParams(
  providerId: string,
  mediaType: MediaParamType,
  params: {
    resolution?: string
    duration?: number
    cameraFixed?: boolean
    watermark?: boolean
    aspectRatio?: string
  }
): Record<string, unknown> {
  const normalizedProviderId = providerId.toLowerCase()

  // Doubao/Volcano Engine mapping
  if (normalizedProviderId.includes('doubao') || normalizedProviderId.includes('volcengine')) {
    if (mediaType === 'video') {
      return {
        resolution: params.resolution || '1080x1920',
        duration: params.duration || 5,
        camera_fixed: params.cameraFixed ?? false,
        watermark: params.watermark ?? false
      }
    }
    if (mediaType === 'image') {
      return {
        resolution: params.resolution || '1024x1024',
        watermark: params.watermark ?? false
      }
    }
  }

  // OpenAI-compatible mapping (DALL-E, etc.)
  if (normalizedProviderId.includes('openai')) {
    if (mediaType === 'image') {
      return {
        size: params.resolution || '1024x1024'
      }
    }
  }

  // Default: return params as-is
  return {
    resolution: params.resolution,
    duration: params.duration,
    camera_fixed: params.cameraFixed,
    watermark: params.watermark,
    aspect_ratio: params.aspectRatio
  }
}

/**
 * Get default media parameters for a provider
 */
export function getDefaultMediaParams(
  providerId: string,
  mediaType: MediaParamType
): {
  resolution?: string
  duration?: number
  cameraFixed?: boolean
  watermark?: boolean
  aspectRatio?: string
} {
  const config = getMediaParamConfig(providerId, mediaType)

  if (!config) {
    return {}
  }

  return {
    resolution: config.resolution?.default,
    duration: config.duration?.default,
    cameraFixed: config.cameraFixed?.default,
    watermark: config.watermark?.default,
    aspectRatio: config.aspectRatio?.default
  }
}
