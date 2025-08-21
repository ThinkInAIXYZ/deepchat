<template>
  <Dialog v-model:open="isOpen" :modal="true">
    <DialogContent class="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle class="flex items-center space-x-2">
          <Icon icon="lucide:help-circle" class="w-5 h-5 text-blue-500" />
          <span>{{ t('migration.troubleshooting.title') }}</span>
        </DialogTitle>
        <DialogDescription>
          {{ t('migration.troubleshooting.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-6">
        <!-- Common Issues -->
        <div class="space-y-4">
          <h3 class="text-lg font-semibold">{{ t('migration.troubleshooting.commonIssues') }}</h3>

          <!-- Disk Space Issue -->
          <div class="border rounded-lg p-4">
            <div class="flex items-start space-x-3">
              <Icon icon="lucide:hard-drive" class="w-5 h-5 text-orange-500 mt-1 flex-shrink-0" />
              <div class="flex-1">
                <h4 class="font-medium text-orange-800">
                  {{ t('migration.troubleshooting.diskSpace.title') }}
                </h4>
                <p class="text-sm text-muted-foreground mt-1">
                  {{ t('migration.troubleshooting.diskSpace.description') }}
                </p>
                <div class="mt-3 space-y-2">
                  <div class="text-sm font-medium">
                    {{ t('migration.troubleshooting.solutions') }}:
                  </div>
                  <ul class="text-sm space-y-1 ml-4">
                    <li class="flex items-start space-x-2">
                      <span class="text-blue-500">•</span>
                      <span>{{ t('migration.troubleshooting.diskSpace.solution1') }}</span>
                    </li>
                    <li class="flex items-start space-x-2">
                      <span class="text-blue-500">•</span>
                      <span>{{ t('migration.troubleshooting.diskSpace.solution2') }}</span>
                    </li>
                    <li class="flex items-start space-x-2">
                      <span class="text-blue-500">•</span>
                      <span>{{ t('migration.troubleshooting.diskSpace.solution3') }}</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <!-- Permission Issue -->
          <div class="border rounded-lg p-4">
            <div class="flex items-start space-x-3">
              <Icon icon="lucide:shield-alert" class="w-5 h-5 text-red-500 mt-1 flex-shrink-0" />
              <div class="flex-1">
                <h4 class="font-medium text-red-800">
                  {{ t('migration.troubleshooting.permission.title') }}
                </h4>
                <p class="text-sm text-muted-foreground mt-1">
                  {{ t('migration.troubleshooting.permission.description') }}
                </p>
                <div class="mt-3 space-y-2">
                  <div class="text-sm font-medium">
                    {{ t('migration.troubleshooting.solutions') }}:
                  </div>
                  <ul class="text-sm space-y-1 ml-4">
                    <li class="flex items-start space-x-2">
                      <span class="text-blue-500">•</span>
                      <span>{{ t('migration.troubleshooting.permission.solution1') }}</span>
                    </li>
                    <li class="flex items-start space-x-2">
                      <span class="text-blue-500">•</span>
                      <span>{{ t('migration.troubleshooting.permission.solution2') }}</span>
                    </li>
                    <li class="flex items-start space-x-2">
                      <span class="text-blue-500">•</span>
                      <span>{{ t('migration.troubleshooting.permission.solution3') }}</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <!-- Corruption Issue -->
          <div class="border rounded-lg p-4">
            <div class="flex items-start space-x-3">
              <Icon
                icon="lucide:alert-triangle"
                class="w-5 h-5 text-yellow-500 mt-1 flex-shrink-0"
              />
              <div class="flex-1">
                <h4 class="font-medium text-yellow-800">
                  {{ t('migration.troubleshooting.corruption.title') }}
                </h4>
                <p class="text-sm text-muted-foreground mt-1">
                  {{ t('migration.troubleshooting.corruption.description') }}
                </p>
                <div class="mt-3 space-y-2">
                  <div class="text-sm font-medium">
                    {{ t('migration.troubleshooting.solutions') }}:
                  </div>
                  <ul class="text-sm space-y-1 ml-4">
                    <li class="flex items-start space-x-2">
                      <span class="text-blue-500">•</span>
                      <span>{{ t('migration.troubleshooting.corruption.solution1') }}</span>
                    </li>
                    <li class="flex items-start space-x-2">
                      <span class="text-blue-500">•</span>
                      <span>{{ t('migration.troubleshooting.corruption.solution2') }}</span>
                    </li>
                    <li class="flex items-start space-x-2">
                      <span class="text-blue-500">•</span>
                      <span>{{ t('migration.troubleshooting.corruption.solution3') }}</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Migration Process -->
        <div class="space-y-4">
          <h3 class="text-lg font-semibold">{{ t('migration.troubleshooting.process.title') }}</h3>
          <div class="space-y-3">
            <div class="flex items-start space-x-3">
              <div
                class="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5"
              >
                <span class="text-xs font-medium text-blue-600">1</span>
              </div>
              <div>
                <div class="font-medium">
                  {{ t('migration.troubleshooting.process.step1.title') }}
                </div>
                <div class="text-sm text-muted-foreground">
                  {{ t('migration.troubleshooting.process.step1.description') }}
                </div>
              </div>
            </div>
            <div class="flex items-start space-x-3">
              <div
                class="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5"
              >
                <span class="text-xs font-medium text-blue-600">2</span>
              </div>
              <div>
                <div class="font-medium">
                  {{ t('migration.troubleshooting.process.step2.title') }}
                </div>
                <div class="text-sm text-muted-foreground">
                  {{ t('migration.troubleshooting.process.step2.description') }}
                </div>
              </div>
            </div>
            <div class="flex items-start space-x-3">
              <div
                class="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5"
              >
                <span class="text-xs font-medium text-blue-600">3</span>
              </div>
              <div>
                <div class="font-medium">
                  {{ t('migration.troubleshooting.process.step3.title') }}
                </div>
                <div class="text-sm text-muted-foreground">
                  {{ t('migration.troubleshooting.process.step3.description') }}
                </div>
              </div>
            </div>
            <div class="flex items-start space-x-3">
              <div
                class="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5"
              >
                <span class="text-xs font-medium text-blue-600">4</span>
              </div>
              <div>
                <div class="font-medium">
                  {{ t('migration.troubleshooting.process.step4.title') }}
                </div>
                <div class="text-sm text-muted-foreground">
                  {{ t('migration.troubleshooting.process.step4.description') }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- FAQ -->
        <div class="space-y-4">
          <h3 class="text-lg font-semibold">{{ t('migration.troubleshooting.faq.title') }}</h3>
          <div class="space-y-3">
            <div v-for="(faq, index) in faqs" :key="index" class="border rounded-lg">
              <button
                @click="toggleFaq(index)"
                class="w-full p-4 text-left flex items-center justify-between hover:bg-gray-50"
              >
                <span class="font-medium">{{ faq.question }}</span>
                <Icon
                  :icon="expandedFaqs.includes(index) ? 'lucide:chevron-up' : 'lucide:chevron-down'"
                  class="w-4 h-4 text-muted-foreground"
                />
              </button>
              <div
                v-if="expandedFaqs.includes(index)"
                class="px-4 pb-4 text-sm text-muted-foreground border-t"
              >
                {{ faq.answer }}
              </div>
            </div>
          </div>
        </div>

        <!-- Contact Support -->
        <div class="border-t pt-4">
          <div class="flex items-start space-x-3">
            <Icon icon="lucide:mail" class="w-5 h-5 text-blue-500 mt-1 flex-shrink-0" />
            <div>
              <div class="font-medium">{{ t('migration.troubleshooting.support.title') }}</div>
              <div class="text-sm text-muted-foreground mt-1">
                {{ t('migration.troubleshooting.support.description') }}
              </div>
              <div class="mt-3 space-x-2">
                <Button size="sm" @click="openDocumentation">
                  <Icon icon="lucide:book-open" class="w-4 h-4 mr-2" />
                  {{ t('migration.troubleshooting.support.documentation') }}
                </Button>
                <Button size="sm" variant="outline" @click="contactSupport">
                  <Icon icon="lucide:mail" class="w-4 h-4 mr-2" />
                  {{ t('migration.troubleshooting.support.contact') }}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button @click="handleClose">
          {{ t('migration.troubleshooting.close') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Icon } from '@iconify/vue'

interface Props {
  open: boolean
}

interface Emits {
  (e: 'update:open', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const { t } = useI18n()

// Reactive state
const isOpen = computed({
  get: () => props.open,
  set: (value) => emit('update:open', value)
})

const expandedFaqs = ref<number[]>([])

// FAQ data
const faqs = computed(() => [
  {
    question: t('migration.troubleshooting.faq.q1.question'),
    answer: t('migration.troubleshooting.faq.q1.answer')
  },
  {
    question: t('migration.troubleshooting.faq.q2.question'),
    answer: t('migration.troubleshooting.faq.q2.answer')
  },
  {
    question: t('migration.troubleshooting.faq.q3.question'),
    answer: t('migration.troubleshooting.faq.q3.answer')
  },
  {
    question: t('migration.troubleshooting.faq.q4.question'),
    answer: t('migration.troubleshooting.faq.q4.answer')
  },
  {
    question: t('migration.troubleshooting.faq.q5.question'),
    answer: t('migration.troubleshooting.faq.q5.answer')
  }
])

// Toggle FAQ expansion
const toggleFaq = (index: number) => {
  const currentIndex = expandedFaqs.value.indexOf(index)
  if (currentIndex > -1) {
    expandedFaqs.value.splice(currentIndex, 1)
  } else {
    expandedFaqs.value.push(index)
  }
}

// Open documentation
const openDocumentation = () => {
  window.electron?.ipcRenderer?.invoke(
    'open-external-url',
    'https://docs.deepchat.com/migration-guide'
  )
}

// Contact support
const contactSupport = () => {
  window.electron?.ipcRenderer?.invoke(
    'open-external-url',
    'mailto:support@deepchat.com?subject=Migration%20Support'
  )
}

// Handle close
const handleClose = () => {
  isOpen.value = false
}
</script>
