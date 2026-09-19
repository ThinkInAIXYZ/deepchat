import { defineComponent, h, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { JsonValue } from './JsonValue'

// JSON数组组件
export const JsonArray = defineComponent({
  name: 'JsonArray',
  props: {
    data: {
      type: Array as () => unknown[],
      required: true
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
    if (this.data.length === 0) {
      return h('span', { class: 'text-xs text-muted-foreground' }, '[ ]')
    }

    return h('div', { class: 'w-full' }, [
      // 数组头部的折叠/展开按钮
      h('div', { class: 'flex items-center mb-1' }, [
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
        h('span', { class: 'text-xs text-muted-foreground' }, `Array [${this.data.length}]`)
      ]),

      // 数组内容
      this.isExpanded
        ? h(
            'div',
            { class: 'pl-2 border-l border-border/40' },
            this.data.map((item, index) => {
              return h('div', { key: index, class: 'mb-2' }, [
                h('div', { class: 'flex flex-wrap items-start gap-2' }, [
                  // 索引标签
                  h(
                    'span',
                    {
                      class:
                        'inline-flex px-2 py-1 min-w-20 max-w-20 truncate rounded-md text-muted-foreground text-xs font-medium leading-6'
                    },
                    String(index)
                  ),

                  // 值容器
                  h('div', { class: 'flex-1 py-1 px-2 bg-background border rounded-md' }, [
                    h(JsonValue, { value: item })
                  ])
                ])
              ])
            })
          )
        : null
    ])
  }
})
