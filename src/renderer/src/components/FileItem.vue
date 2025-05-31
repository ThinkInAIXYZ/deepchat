<template>
  <div
    class="inline-block"
    @contextmenu.prevent="handleContextMenu"
  >
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger as-child>
          <div
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
import { Icon } from '@iconify/vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const props = withDefaults(
  defineProps<{
    fileName: string
    deletable: boolean
    mimeType?: string
    tokens: number
    thumbnail?: string
  }>(),
  {
    mimeType: 'text/plain'
  }
)

const emit = defineEmits<{
  click: [fileName: string]
  delete: [fileName: string]
  'file-context-menu': [{ fileName: string; mimeType: string }]
}>()

const handleContextMenu = (event: MouseEvent) => {
  emit('file-context-menu', {
    fileName: props.fileName,
    mimeType: props.mimeType
  })
}

const getFileIcon = () => {
  // 根据 MIME 类型返回对应的图标
  if (
    props.mimeType.startsWith('text/plain') ||
    props.mimeType.startsWith('application/json') ||
    props.mimeType.startsWith('application/javascript') ||
    props.mimeType.startsWith('application/typescript')
  ) {
    return 'vscode-icons:file-type-text'
  } else if (props.mimeType.startsWith('text/csv')) {
    return 'vscode-icons:file-type-excel'
  } else if (
    props.mimeType.startsWith('application/vnd.ms-excel') ||
    props.mimeType.includes('spreadsheet') ||
    props.mimeType.includes('numbers')
  ) {
    return 'vscode-icons:file-type-excel'
  } else if (props.mimeType.startsWith('text/markdown')) {
    return 'vscode-icons:file-type-markdown'
  } else if (props.mimeType.startsWith('application/x-yaml')) {
    return 'vscode-icons:file-type-yaml'
  } else if (
    props.mimeType.startsWith('application/xml') ||
    props.mimeType.startsWith('application/xhtml+xml')
  ) {
    return 'vscode-icons:file-type-xml'
  } else if (props.mimeType.startsWith('application/pdf')) {
    return 'vscode-icons:file-type-pdf2'
  } else if (props.mimeType.startsWith('image/')) {
    return 'vscode-icons:file-type-image'
  } else if (
    props.mimeType.startsWith('application/msword') ||
    props.mimeType.includes('wordprocessingml')
  ) {
    return 'vscode-icons:file-type-word'
  } else if (
    props.mimeType.startsWith('application/vnd.ms-powerpoint') ||
    props.mimeType.includes('presentationml')
  ) {
    return 'vscode-icons:file-type-powerpoint'
  } else if (props.mimeType.startsWith('text/html')) {
    return 'vscode-icons:file-type-html'
  } else if (props.mimeType.startsWith('text/css')) {
    return 'vscode-icons:file-type-css'
  } else if (props.mimeType.startsWith('audio/')) {
    return 'vscode-icons:file-type-audio'
  } else if (props.mimeType.startsWith('directory')) {
    return 'vscode-icons:default-folder-opened'
  } else {
    // 默认文件图标
    return 'vscode-icons:default-file'
  }
}
</script>
