<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-2xl max-h-[85vh] flex flex-col">
      <DialogHeader>
        <DialogTitle>{{ t('settings.acp.dependency.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.acp.dependency.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex-1 overflow-y-auto space-y-4 pr-2">
        <div
          v-for="(dep, index) in dependencies"
          :key="index"
          class="border rounded-lg p-4 space-y-3 bg-zinc-50 dark:bg-zinc-900"
        >
          <div>
            <h3 class="font-semibold text-lg text-foreground">{{ dep.name }}</h3>
            <p class="text-sm text-muted-foreground mt-1">{{ dep.description }}</p>
          </div>

          <!-- Installation Commands -->
          <div
            v-if="dep.installCommands && hasInstallCommands(dep.installCommands)"
            class="space-y-2"
          >
            <Label class="text-sm font-medium">{{
              t('settings.acp.dependency.installCommands')
            }}</Label>
            <div class="space-y-2">
              <template v-for="(command, cmdType) in dep.installCommands" :key="cmdType">
                <div v-if="command" class="flex items-center gap-2">
                  <div class="flex-1 flex items-center gap-2 bg-background border rounded-md p-2">
                    <code class="flex-1 text-sm font-mono text-foreground break-all">{{
                      command
                    }}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="h-8 w-8 shrink-0"
                      @click="copyToClipboard(command)"
                      :title="t('settings.acp.dependency.copy')"
                    >
                      <Icon icon="lucide:copy" class="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- Download URL -->
          <div v-if="dep.downloadUrl" class="space-y-2">
            <Label class="text-sm font-medium">{{
              t('settings.acp.dependency.downloadUrl')
            }}</Label>
            <div class="flex items-center gap-2 bg-background border rounded-md p-2">
              <a
                :href="dep.downloadUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="flex-1 text-sm text-primary hover:underline break-all"
              >
                {{ dep.downloadUrl }}
              </a>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 shrink-0"
                @click="copyToClipboard(dep.downloadUrl)"
                :title="t('settings.acp.dependency.copy')"
              >
                <Icon icon="lucide:copy" class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="mt-4">
        <Button @click="emit('update:open', false)">
          {{ t('common.close') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useToast } from '@/components/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'
import { Label } from '@shadcn/components/ui/label'
import { Icon } from '@iconify/vue'

interface ExternalDependency {
  name: string
  description: string
  platform?: string[]
  checkCommand?: string
  checkPaths?: string[]
  installCommands?: {
    winget?: string
    chocolatey?: string
    scoop?: string
  }
  downloadUrl?: string
  requiredFor?: string[]
}

defineProps<{
  open: boolean
  dependencies: ExternalDependency[]
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const { t } = useI18n()
const { toast } = useToast()

const hasInstallCommands = (commands: ExternalDependency['installCommands']): boolean => {
  if (!commands) return false
  return Boolean(commands.winget || commands.chocolatey || commands.scoop)
}

const copyToClipboard = async (text: string) => {
  try {
    if (window.api?.copyText) {
      window.api.copyText(text)
      toast({
        title: t('settings.acp.dependency.copied'),
        duration: 2000
      })
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      toast({
        title: t('settings.acp.dependency.copied'),
        duration: 2000
      })
    } else {
      console.warn('[AcpDependencyDialog] Clipboard API not available')
    }
  } catch (error) {
    console.error('[AcpDependencyDialog] Failed to copy to clipboard:', error)
    toast({
      title: t('settings.acp.dependency.copyFailed'),
      variant: 'destructive'
    })
  }
}
</script>
