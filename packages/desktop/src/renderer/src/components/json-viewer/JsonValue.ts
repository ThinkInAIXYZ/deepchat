import { defineComponent, h } from 'vue'
import { JsonObject } from './JsonObject'
import { JsonArray } from './JsonArray'

// JSON键值对组件
export const JsonValue = defineComponent({
  name: 'JsonValue',
  props: {
    value: {
      type: null,
      required: true
    }
  },
  setup() {
    const isObject = (val: unknown): val is Record<string, unknown> =>
      val !== null && typeof val === 'object' && !Array.isArray(val)

    const isArray = (val: unknown): val is unknown[] => Array.isArray(val)

    const isPrimitive = (val: unknown): val is string | number | boolean | null =>
      val === null || ['string', 'number', 'boolean'].includes(typeof val)

    const getTypeClass = (val: unknown): string => {
      if (val === null) return 'text-gray-500 leading-6'
      if (typeof val === 'string') return 'text-green-600 dark:text-green-400 leading-6'
      if (typeof val === 'number') return 'text-blue-600 dark:text-blue-400 leading-6'
      if (typeof val === 'boolean') return 'text-purple-600 dark:text-purple-400 leading-6'
      return ''
    }

    return { isObject, isArray, isPrimitive, getTypeClass }
  },
  render() {
    const value = this.value

    if (this.isPrimitive(value)) {
      if (value === null) {
        return h('span', { class: this.getTypeClass(value) }, 'null')
      }
      if (typeof value === 'string') {
        return h('span', { class: this.getTypeClass(value) }, `${value}`)
      }
      return h('span', { class: this.getTypeClass(value) }, String(value))
    }

    if (this.isObject(value)) {
      return h(JsonObject, { data: value, isNested: true })
    }

    if (this.isArray(value)) {
      return h(JsonArray, { data: value })
    }

    return h('span', {}, String(value))
  }
})
