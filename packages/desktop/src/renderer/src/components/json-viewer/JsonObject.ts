import { defineComponent, h, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { JsonValue } from './JsonValue'

// JSON对象组件
export const JsonObject = defineComponent({
  name: 'JsonObject',
  props: {
    data: {
      type: Object as () => Record<string, unknown>,
      required: true
    },
    isNested: {
      type: Boolean,
      default: false
    }
  },
  setup() {
    const isExpanded = ref(true)

    const toggleExpanded = () => {
      isExpanded.value = !isExpanded.value
    }

    return { isExpanded, toggleExpanded }
  },
  render() {
    const entries = Object.entries(this.data)

    if (entries.length === 0) {
      return h('span', { class: 'text-xs text-muted-foreground' }, '{ }')
    }

    return h('div', { class: 'w-full' }, [
      // 对象头部的折叠/展开按钮
      this.isNested
        ? h('div', { class: 'flex items-center py-1' }, [
            h(
              'button',
              {
                class: 'p-0.5 rounded hover:bg-muted mr-1',
                onClick: this.toggleExpanded
              },
              [
                h(Icon, {
                  icon: this.isExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right',
                  class: 'h-3 w-3 text-muted-foreground'
                })
              ]
            ),
            h('span', { class: 'text-xs text-muted-foreground' }, `Object {${entries.length}}`)
          ])
        : null,

      // 对象内容
      this.isExpanded
        ? h(
            'div',
            {
              class: this.isNested ? 'ml-2 pl-1 border-l border-muted space-y-2' : ' space-y-2'
            },
            entries.map(([key, value]) => {
              return h('div', { key }, [
                h('div', { class: 'flex flex-wrap items-start gap-2' }, [
                  // 键标签
                  h(
                    'span',
                    {
                      class:
                        'inline-flex px-2 py-1 min-w-20 max-w-20 truncate rounded-md text-muted-foreground text-xs font-medium leading-6'
                    },
                    key
                  ),

                  // 值容器
                  h(
                    'div',
                    {
                      class:
                        'flex-1 py-1 text-xs px-2 bg-background border rounded-md max-h-64 overflow-auto break-words whitespace-pre-wrap'
                    },
                    [h(JsonValue, { value })]
                  )
                ])
              ])
            })
          )
        : null
    ])
  }
})
