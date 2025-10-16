// === Types for ChatConfig field definitions ===

export type FieldType = 'slider' | 'input' | 'select' | 'switch' | 'textarea'

export interface BaseFieldConfig {
  key: string
  type: FieldType
  icon: string
  label: string
  description?: string
  visible?: () => boolean
}

export interface SliderFieldConfig extends BaseFieldConfig {
  type: 'slider'
  min: number
  max: number
  step: number
  formatter?: (value: number) => string
  getValue: () => number
  setValue: (value: number) => void
}

export interface InputFieldConfig extends BaseFieldConfig {
  type: 'input'
  inputType?: 'text' | 'number'
  min?: number
  max?: number
  step?: number
  placeholder?: string
  getValue: () => number | string | undefined
  setValue: (value: number | string | undefined) => void
  error?: () => string
  hint?: () => string
}

export interface SelectOption {
  value: string
  label: string
}

export interface SelectFieldConfig extends BaseFieldConfig {
  type: 'select'
  options: SelectOption[] | (() => SelectOption[])
  placeholder?: string
  hint?: string
  getValue: () => string | undefined
  setValue: (value: string) => void
}

export interface SwitchFieldConfig extends BaseFieldConfig {
  type: 'switch'
  getValue: () => boolean
  setValue: (value: boolean) => void
}

export interface TextareaFieldConfig extends BaseFieldConfig {
  type: 'textarea'
  placeholder?: string
  getValue: () => string | undefined
  setValue: (value: string) => void
}

export type FieldConfig =
  | SliderFieldConfig
  | InputFieldConfig
  | SelectFieldConfig
  | SwitchFieldConfig
  | TextareaFieldConfig

export interface FieldSection {
  title?: string
  fields: FieldConfig[]
  visible?: () => boolean
}
