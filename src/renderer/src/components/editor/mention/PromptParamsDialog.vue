<template>
  <Dialog :open="true" @update:open="$emit('close')">
    <DialogContent class="sm:max-w-[425px] z-[100]">
      <DialogHeader>
        <DialogTitle>{{ promptName }} 参数设置</DialogTitle>
        <DialogDescription> 请填写以下参数，带 * 的为必填项 </DialogDescription>
      </DialogHeader>

      <ScrollArea class="h-96 w-full pr-3">
        <div class="grid gap-4 py-4">
          <div v-for="(param, index) in params" :key="param.name" class="space-y-2">
            <div class="flex items-center gap-2">
              <Label :for="param.name" class="text-sm font-medium">
                {{ param.name }}
                <span v-if="param.required" class="text-red-500">*</span>
              </Label>
              <span class="text-xs text-muted-foreground">{{ param.description }}</span>
            </div>
            <Input
              :id="param.name"
              v-model="paramValues[param.name]"
              :class="{ 'border-red-500': errors[param.name] }"
              @keydown.enter="handleEnter(index)"
              @keydown.esc="$emit('close')"
            />
            <p v-if="errors[param.name]" class="text-xs text-red-500">
              {{ errors[param.name] }}
            </p>
          </div>
        </div>
      </ScrollArea>
      <DialogFooter>
        <Button variant="outline" @click="$emit('close')"> 取消 </Button>
        <Button :disabled="hasErrors" @click="handleSubmit"> 确认 </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'

interface PromptParam {
  name: string
  description: string
  required: boolean
}

const props = defineProps<{
  promptName: string
  params: PromptParam[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', values: Record<string, string>): void
}>()

const paramValues = ref<Record<string, string>>({})
const errors = ref<Record<string, string>>({})

// 初始化参数值
onMounted(() => {
  props.params.forEach((param) => {
    paramValues.value[param.name] = ''
  })
})

// 验证参数
const validateParams = () => {
  let hasError = false
  errors.value = {}

  props.params.forEach((param) => {
    if (param.required && !paramValues.value[param.name]) {
      errors.value[param.name] = '此参数为必填项'
      hasError = true
    }
  })

  return !hasError
}

// 处理回车键
const handleEnter = (index: number) => {
  if (index === props.params.length - 1) {
    handleSubmit()
  }
}

// 处理提交
const handleSubmit = () => {
  if (validateParams()) {
    emit('submit', paramValues.value)
  }
}

// 计算是否有错误或缺少必填参数
const hasErrors = computed(() => {
  // 检查是否有验证错误
  if (Object.keys(errors.value).length > 0) {
    return true
  }

  // 检查是否有必填参数未填写
  return props.params.some((param) => {
    if (param.required) {
      const value = paramValues.value[param.name]
      return !value || value.trim() === ''
    }
    return false
  })
})
</script>
