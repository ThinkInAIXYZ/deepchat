<template>
  <div class="inline-block">
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <!-- 图片文件在消息中使用特殊布局 -->
          <div
            v-if="isImageFile && thumbnail && context === 'message'"
            class="flex flex-col gap-2 bg-card border items-center shadow-sm justify-start rounded-md text-xs cursor-pointer select-none hover:bg-accent relative p-2"
            @click="$emit('click', fileName)"
          >
            <img :src="thumbnail" class="w-20 h-20 rounded-md border object-cover" />
            <div class="text-center max-w-20">
              <div class="text-xs leading-none pb-1 truncate text-ellipsis whitespace-nowrap">
                {{ fileName }}
              </div>
              <div
                class="text-[10px] leading-none text-muted-foreground truncate text-ellipsis whitespace-nowrap"
              >
                {{ mimeType }}
              </div>
            </div>
            <span
              v-if="deletable"
              class="bg-card shadow-sm flex items-center justify-center absolute rounded-full -top-1 -right-1 p-0.5 border"
              @click.stop.prevent="$emit('delete', fileName)"
            >
              <Icon icon="lucide:x" class="w-3 h-3 text-muted-foreground" />
            </span>
          </div>
          <!-- 非图片文件或输入框中的图片使用原有布局 -->
          <div
            v-else
            class="flex py-1.5 pl-1.5 pr-3 gap-2 flex-row bg-card border items-center shadow-sm justify-start rounded-md text-xs cursor-pointer select-none hover:bg-accent relative"
            @click="$emit('click', fileName)"
          >
            <img v-if="thumbnail" :src="thumbnail" class="w-8 h-8 rounded-md border" />
            <Icon
              v-else
              :icon="getFileIcon()"
              class="w-8 h-8 text-muted-foreground p-1 bg-accent rounded-md border"
            />

            <div class="flex-grow flex-1 max-w-28">
              <div class="text-xs leading-none pb-1 truncate text-ellipsis whitespace-nowrap">
                {{ fileName }}
              </div>
              <div
                class="text-[10px] leading-none text-muted-foreground truncate text-ellipsis whitespace-nowrap"
              >
                {{ mimeType }}
              </div>
            </div>
            <span
              v-if="deletable"
              class="bg-card shadow-sm flex items-center justify-center absolute rounded-full -top-1 -right-2 p-0.5 border"
              @click.stop.prevent="$emit('delete', fileName)"
            >
              <Icon icon="lucide:x" class="w-3 h-3 text-muted-foreground" />
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{{ tokens }} tokens</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getMimeTypeIcon } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    fileName: string
    deletable: boolean
    mimeType?: string
    tokens: number
    thumbnail?: string
    context?: 'input' | 'message'
  }>(),
  {
    mimeType: 'text/plain',
    context: 'message'
  }
)

defineEmits<{
  click: [fileName: string]
  delete: [fileName: string]
}>()

const getFileIcon = () => {
  return getMimeTypeIcon(props.mimeType)
}

const isImageFile = computed(() => {
  return props.mimeType?.startsWith('image/') || false
})
</script>
