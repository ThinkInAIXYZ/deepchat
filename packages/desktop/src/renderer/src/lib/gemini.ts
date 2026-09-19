// Define safety categories and mapping
export type SafetyCategoryKey =
  | 'harassment'
  | 'hateSpeech'
  | 'sexuallyExplicit'
  | 'dangerousContent'
export type SafetySettingValue =
  | 'BLOCK_NONE'
  | 'BLOCK_LOW_AND_ABOVE'
  | 'BLOCK_MEDIUM_AND_ABOVE'
  | 'BLOCK_ONLY_HIGH'
  | 'HARM_BLOCK_THRESHOLD_UNSPECIFIED'

export const safetyCategories: Record<
  SafetyCategoryKey,
  { label: string; harmCategory: string; defaultLevel: number }
> = {
  harassment: {
    label: 'settings.provider.safety.harassment',
    harmCategory: 'HARM_CATEGORY_HARASSMENT',
    defaultLevel: 0
  },
  hateSpeech: {
    label: 'settings.provider.safety.hateSpeech',
    harmCategory: 'HARM_CATEGORY_HATE_SPEECH',
    defaultLevel: 0
  },
  sexuallyExplicit: {
    label: 'settings.provider.safety.sexuallyExplicit',
    harmCategory: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    defaultLevel: 0
  },
  dangerousContent: {
    label: 'settings.provider.safety.dangerousContent',
    harmCategory: 'HARM_CATEGORY_DANGEROUS_CONTENT',
    defaultLevel: 0
  }
}

export const levelToValueMap: Record<number, SafetySettingValue> = {
  0: 'BLOCK_NONE',
  1: 'BLOCK_LOW_AND_ABOVE',
  2: 'BLOCK_MEDIUM_AND_ABOVE',
  3: 'BLOCK_ONLY_HIGH'
}

export const levelLabels: Record<number, string> = {
  0: 'settings.provider.safety.blockNone',
  1: 'settings.provider.safety.blockSome',
  2: 'settings.provider.safety.blockMost',
  3: 'settings.provider.safety.blockHighest'
}
