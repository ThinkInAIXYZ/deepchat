<script lang="ts">
import { computed, defineComponent, h, onUnmounted, ref, type PropType } from 'vue'
import { useClipboard } from '@vueuse/core'
import { cn } from '@shadcn/lib/utils'
import { type DcButtonProps } from './props'
import DcButton from './DcButton.vue'

interface DcCopyButtonProps extends DcButtonProps {
  copyText?: string
}

export default defineComponent({
  name: 'DcCopyButton',
  inheritAttrs: false,
  props: {
    copyText: String,
    variant: {
      type: String as PropType<DcCopyButtonProps['variant']>,
      default: 'ghost'
    }
  },
  emits: {
    copied: () => true,
    error: (_error: unknown) => true
  },
  setup(props, { attrs, emit, slots }) {
    const copied = ref(false)
    let timer: ReturnType<typeof setTimeout> | undefined
    const { copy } = useClipboard()
    const icon = computed(() => (copied.value ? 'lucide:check' : 'lucide:copy'))

    const copyText = async () => {
      if (!props.copyText) return
      try {
        await copy(props.copyText)
        copied.value = true
        clearTimeout(timer)
        timer = setTimeout(() => {
          copied.value = false
        }, 1200)
        emit('copied')
      } catch (error) {
        console.error('[DcCopyButton] Failed to copy', error)
        emit('error', error)
      }
    }

    onUnmounted(() => clearTimeout(timer))

    return () => {
      const inheritedAttrs = attrs as Partial<DcButtonProps> & Record<string, unknown>
      const { copyText: _copyText, ...buttonProps } = props
      const accessibleName = inheritedAttrs.label ?? inheritedAttrs.tooltip ?? _copyText

      return h(
        DcButton,
        {
          ...inheritedAttrs,
          ...buttonProps,
          key: icon.value,
          icon: icon.value,
          iconClass: cn(
            inheritedAttrs.iconClass,
            copied.value && 'animate-in zoom-in-75 duration-200'
          ),
          label: accessibleName,
          class: cn(
            'shrink-0',
            copied.value ? 'text-emerald-600 dark:text-emerald-400' : '',
            inheritedAttrs.class
          ),
          onClick: copyText
        },
        slots
      )
    }
  }
})
</script>
