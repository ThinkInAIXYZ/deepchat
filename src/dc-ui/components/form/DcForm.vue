<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { provide, useAttrs } from 'vue'
import { Form } from '@shadcn/components/ui/form'
import { DC_FORM_INJECTION_KEY, type DcFormContext } from './useDcForm'
import { useDcFormSubmit } from './useDcFormSubmit'

defineOptions({ inheritAttrs: false })

interface Props {
  successDuration?: number
  errorDuration?: number
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

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

// 调用方的 @submit 监听器留在 attrs 中（未声明为 emit），包一层 run() 驱动提交状态
const attrs = useAttrs()
const { onSubmit: onSubmitAttr, ...formAttrs } = attrs
const handleSubmit = (values: unknown, ctx: unknown) => {
  void run(async () => {
    await (onSubmitAttr as ((v: unknown, c: unknown) => void | Promise<void>) | undefined)?.(
      values,
      ctx
    )
  })
}
</script>

<template>
  <Form v-bind="formAttrs" :class="props.class" @submit="handleSubmit">
    <slot />
  </Form>
</template>
