import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

export function useMemoryNumberFormatters() {
  const { locale } = useI18n()
  const decimalFormatter = computed(
    () =>
      new Intl.NumberFormat(locale.value || undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3
      })
  )
  const dayFormatter = computed(
    () =>
      new Intl.NumberFormat(locale.value || undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1
      })
  )

  const formatDecimal = (value: number): string =>
    Number.isFinite(value) ? decimalFormatter.value.format(value) : String(value)
  const formatDays = (value: number): string =>
    Number.isFinite(value) ? dayFormatter.value.format(value) : String(value)

  return { formatDecimal, formatDays }
}
