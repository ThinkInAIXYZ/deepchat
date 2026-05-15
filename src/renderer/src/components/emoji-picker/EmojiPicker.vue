<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'

// Import new shadcn tabs components
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shadcn/components/ui/tabs'

const { t } = useI18n()

defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

// Emoji categories
const categories = [
  { id: 'smileys', name: t('components.emojiPicker.smileys', 'Smileys & Emotion'), icon: '😀' },
  { id: 'people', name: t('components.emojiPicker.people', 'People & Body'), icon: '👨' },
  { id: 'animals', name: t('components.emojiPicker.animals', 'Animals & Nature'), icon: '🐶' },
  { id: 'food', name: t('components.emojiPicker.food', 'Food & Drink'), icon: '🍔' },
  { id: 'travel', name: t('components.emojiPicker.travel', 'Travel & Places'), icon: '✈️' },
  { id: 'activities', name: t('components.emojiPicker.activities', 'Activities'), icon: '⚽' },
  { id: 'objects', name: t('components.emojiPicker.objects', 'Objects'), icon: '💡' },
  { id: 'symbols', name: t('components.emojiPicker.symbols', 'Symbols'), icon: '❤️' }
]

// Emoji data by category
const emojiData = {
  smileys: [
    '😀',
    '😃',
    '😄',
    '😁',
    '😆',
    '😅',
    '😂',
    '🤣',
    '😊',
    '😇',
    '🙂',
    '🙃',
    '😉',
    '😌',
    '😍',
    '🥰',
    '😘',
    '😗',
    '😙',
    '😚',
    '😋',
    '😛',
    '😝',
    '😜',
    '🤪',
    '🤨',
    '🧐',
    '🤓',
    '😎',
    '🤩',
    '🥳',
    '😏',
    '😒',
    '😞',
    '😔',
    '😟',
    '😕',
    '🙁',
    '☹️',
    '😣',
    '😖',
    '😫',
    '😩',
    '🥺',
    '😢',
    '😭',
    '😤',
    '😠',
    '😡',
    '🤬',
    '🤯'
  ],
  people: [
    '👋',
    '🤚',
    '✋',
    '🖐️',
    '👌',
    '🤏',
    '✌️',
    '🤞',
    '🤟',
    '🤘',
    '🤙',
    '👈',
    '👉',
    '👆',
    '🖕',
    '👇',
    '☝️',
    '👍',
    '👎',
    '✊',
    '👊',
    '🤛',
    '🤜',
    '👏',
    '🙌',
    '👐',
    '🤲',
    '🤝',
    '🙏',
    '✍️',
    '💅',
    '🤳',
    '💪',
    '🦾',
    '🦿',
    '🦵',
    '🦶',
    '👂',
    '🦻',
    '👃',
    '🧠',
    '🦷',
    '🦴',
    '👀',
    '👁️',
    '👅',
    '👄',
    '💋',
    '🩸'
  ],
  animals: [
    '🐶',
    '🐱',
    '🐭',
    '🐹',
    '🐰',
    '🦊',
    '🐻',
    '🐼',
    '🐨',
    '🐯',
    '🦁',
    '🐮',
    '🐷',
    '🐽',
    '🐸',
    '🐵',
    '🙈',
    '🙉',
    '🙊',
    '🐒',
    '🐔',
    '🐧',
    '🐦',
    '🐤',
    '🐣',
    '🐥',
    '🦆',
    '🦅',
    '🦉',
    '🦇',
    '🐺',
    '🐗',
    '🐴',
    '🦄',
    '🐝',
    '🐛',
    '🦋',
    '🐌',
    '🐞',
    '🐜',
    '🦟',
    '🦗',
    '🕷️',
    '🕸️',
    '🦂',
    '🦠'
  ],
  food: [
    '🍏',
    '🍎',
    '🍐',
    '🍊',
    '🍋',
    '🍌',
    '🍉',
    '🍇',
    '🍓',
    '🍈',
    '🍒',
    '🍑',
    '🥭',
    '🍍',
    '🥥',
    '🥝',
    '🍅',
    '🍆',
    '🥑',
    '🥦',
    '🥬',
    '🥒',
    '🌶️',
    '🌽',
    '🥕',
    '🧄',
    '🧅',
    '🥔',
    '🍠',
    '🥐',
    '🥯',
    '🍞',
    '🥖',
    '🥨',
    '🧀',
    '🥚',
    '🍳',
    '🧈',
    '🥞',
    '🧇',
    '🥓',
    '🥩',
    '🍗',
    '🍖',
    '🦴',
    '🌭'
  ],
  travel: [
    '🚗',
    '🚕',
    '🚙',
    '🚌',
    '🚎',
    '🏎️',
    '🚓',
    '🚑',
    '🚒',
    '🚐',
    '🚚',
    '🚛',
    '🚜',
    '🦯',
    '🦽',
    '🦼',
    '🛴',
    '🚲',
    '🛵',
    '🏍️',
    '🛺',
    '🚨',
    '🚔',
    '🚍',
    '🚘',
    '🚖',
    '🚡',
    '🚠',
    '🚟',
    '🚃',
    '🚋',
    '🚞',
    '🚝',
    '🚄',
    '🚅',
    '🚈',
    '🚂',
    '🚆',
    '🚇',
    '🚊',
    '🚉',
    '✈️',
    '🛫',
    '🛬',
    '🛩️',
    '💺'
  ],
  activities: [
    '⚽',
    '🏀',
    '🏈',
    '⚾',
    '🥎',
    '🎾',
    '🏐',
    '🏉',
    '🥏',
    '🎱',
    '🪀',
    '🏓',
    '🏸',
    '🏒',
    '🏑',
    '🥍',
    '🏏',
    '🥅',
    '⛳',
    '🪁',
    '🏹',
    '🎣',
    '🤿',
    '🥊',
    '🥋',
    '🎽',
    '🛹',
    '🛼',
    '🛷',
    '⛸️',
    '🥌',
    '🎿',
    '⛷️',
    '🏂',
    '🪂',
    '🏋️',
    '🤼',
    '🤸',
    '🤽',
    '🤾',
    '🤺',
    '🏊',
    '🏄',
    '🧘'
  ],
  objects: [
    '⌚',
    '📱',
    '📲',
    '💻',
    '⌨️',
    '🖥️',
    '🖨️',
    '🖱️',
    '🖲️',
    '🕹️',
    '🗜️',
    '💽',
    '💾',
    '💿',
    '📀',
    '📼',
    '📷',
    '📸',
    '📹',
    '🎥',
    '📽️',
    '🎞️',
    '📞',
    '☎️',
    '📟',
    '📠',
    '📺',
    '📻',
    '🎙️',
    '🎚️',
    '🎛️',
    '🧭',
    '⏱️',
    '⏲️',
    '⏰',
    '🕰️',
    '⌛',
    '⏳',
    '📡',
    '🔋',
    '🔌',
    '💡',
    '🔦',
    '🕯️'
  ],
  symbols: [
    '❤️',
    '🧡',
    '💛',
    '💚',
    '💙',
    '💜',
    '🖤',
    '🤍',
    '🤎',
    '💔',
    '❣️',
    '💕',
    '💞',
    '💓',
    '💗',
    '💖',
    '💘',
    '💝',
    '💟',
    '☮️',
    '✝️',
    '☪️',
    '🕉️',
    '☸️',
    '✡️',
    '🔯',
    '🕎',
    '☯️',
    '☦️',
    '🛐',
    '⛎',
    '♈',
    '♉',
    '♊',
    '♋',
    '♌',
    '♍',
    '♎',
    '♏',
    '♐',
    '♑',
    '♒',
    '♓',
    '🆔',
    '⚛️'
  ]
}

const searchQuery = ref('')
const isOpen = ref(false)
const selectedTab = ref('smileys')

// Filtered emojis based on search query
const filteredEmojis = computed(() => {
  if (!searchQuery.value) {
    return emojiData
  }

  const query = searchQuery.value.toLowerCase()
  const result: Record<string, string[]> = {}

  for (const [category, emojis] of Object.entries(emojiData)) {
    result[category] = emojis.filter((emoji) => {
      return emoji.toLowerCase().includes(query)
    })
  }

  return result
})

// Handle emoji selection
const selectEmoji = (emoji: string) => {
  emit('update:modelValue', emoji)
  isOpen.value = false
}
</script>

<template>
  <DropdownMenu v-model:open="isOpen">
    <DropdownMenuTrigger as-child>
      <Button variant="outline" size="icon" class="w-10 flex items-center justify-center text-sm">
        {{ modelValue || '📁' }}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-80 p-0">
      <div class="p-2">
        <Tabs v-model="selectedTab">
          <TabsList class="flex overflow-x-auto w-full justify-between">
            <TabsTrigger
              v-for="category in categories"
              :key="category.id"
              :value="category.id"
              class="w-0 grow py-1"
              :title="category.name"
            >
              {{ category.icon }}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            v-for="category in categories"
            :key="category.id"
            :value="category.id"
            class="mt-2 focus:outline-none"
          >
            <ScrollArea class="h-40">
              <div class="grid grid-cols-8 gap-1">
                <Button
                  v-for="emoji in filteredEmojis[category.id]"
                  :key="emoji"
                  variant="ghost"
                  class="p-1 h-8 w-8 flex items-center justify-center"
                  @click="selectEmoji(emoji)"
                >
                  {{ emoji }}
                </Button>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
