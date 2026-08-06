<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, provide, useAttrs } from 'vue'
import { Form } from '@shadcn/components/ui/form'
import { DC_FORM_INJECTION_KEY, type DcFormContext } from './useDcForm'
import { useDcFormSubmit } from './useDcFormSubmit'

interface Props {
  successDuration?: number
  errorDuration?: number
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

defineOptions({
  inheritAttrs: false
})

const emit = defineEmits<{
  (e: 'success'): void
  (e: 'error', error: unknown): void
}>()

const { status, run, reset } = useDcFormSubmit({
  successDuration: props.successDuration,
  errorDuration: props.errorDuration,
  onSuccess: () => emit('success'),
  onError: (error) => emit('error', error)
})

provide<DcFormContext>(DC_FORM_INJECTION_KEY, { status, run, reset })

// 调用方的 @submit 监听器留在 attrs 中（未声明为 emit），包一层 run() 驱动提交状态。
// 禁用自动 fallthrough，避免 vee-validate 同时收到包装后的和原始的 submit listener。
const attrs = useAttrs()
const formAttrs = computed(() => {
  const { onSubmit: _onSubmit, ...rest } = attrs
  return rest
})

const handleSubmit = (values: unknown, ctx: unknown) => {
  const onSubmit = attrs.onSubmit

  void run(async () => {
    if (typeof onSubmit === 'function') {
      await onSubmit(values, ctx)
    }
  }).catch(() => undefined)
}
</script>

<template>
  <Form v-bind="formAttrs" :class="props.class" @submit="handleSubmit">
    <slot />
  </Form>
</template>
