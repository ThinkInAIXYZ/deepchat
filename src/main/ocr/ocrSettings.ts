import type { DeepchatEventPublisher } from '@shared/contracts/events'
import type { SettingsStore } from '@/config/settingsStore'
import type { LightOcrBackendPreference } from './lightOcrProtocol'

const AUTOMATIC_OCR_SETTING_KEY = 'ocr.autoExtractForNonVisionModels'
const OCR_BACKEND_SETTING_KEY = 'ocr.backend'

export interface OcrSettingsPort {
  getAutomaticExtractionEnabled(): boolean
  setAutomaticExtractionEnabled(enabled: boolean): void
  getBackend(): LightOcrBackendPreference
  setBackend(backend: LightOcrBackendPreference): void
}

export class OcrSettings implements OcrSettingsPort {
  constructor(
    private readonly settings: Pick<SettingsStore, 'get' | 'set'>,
    private readonly publishEvent: DeepchatEventPublisher
  ) {}

  getAutomaticExtractionEnabled(): boolean {
    return this.settings.get<boolean>(AUTOMATIC_OCR_SETTING_KEY) ?? true
  }

  setAutomaticExtractionEnabled(enabled: boolean): void {
    const value = Boolean(enabled)
    this.settings.set(AUTOMATIC_OCR_SETTING_KEY, value)
    this.publishEvent('settings.changed', {
      changedKeys: ['ocrAutoExtractForNonVisionModels'],
      version: Date.now(),
      values: { ocrAutoExtractForNonVisionModels: value }
    })
  }

  getBackend(): LightOcrBackendPreference {
    return this.settings.get<string>(OCR_BACKEND_SETTING_KEY) === 'cpu' ? 'cpu' : 'auto'
  }

  setBackend(backend: LightOcrBackendPreference): void {
    const value = backend === 'cpu' ? 'cpu' : 'auto'
    this.settings.set(OCR_BACKEND_SETTING_KEY, value)
    this.publishEvent('settings.changed', {
      changedKeys: ['ocrBackend'],
      version: Date.now(),
      values: { ocrBackend: value }
    })
  }
}
