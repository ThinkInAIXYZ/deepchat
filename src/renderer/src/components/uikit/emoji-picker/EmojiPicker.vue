<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@shadcn/components/ui/button'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@shadcn/components/ui/dropdown-menu'
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
  { id: 'symbols', name: t('components.emojiPicker.symbols', 'Symbols'), icon: '❤️' },
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
        <Tabs default-value="smileys" class="flex flex-col gap-2">
          <TabsList class="flex overflow-x-auto w-full gap-1">
            <TabsTrigger
              v-for="category in categories"
              :key="category.id"
              :value="category.id"
              class="min-w-0 flex-1 px-2 py-1"
              :title="category.name"
            >
              {{ category.icon }}
            </TabsTrigger>
          </TabsList>
          <div class="mt-2">
            <TabsContent
              v-for="category in categories"
              :key="category.id"
              :value="category.id"
              class="focus-visible:outline-none focus-visible:ring-0"
            >
              <ScrollArea class="h-40">
                <div class="grid grid-cols-8 gap-1">
                  <Button
                    v-for="emoji in filteredEmojis[category.id]"
                    :key="emoji"
                    variant="ghost"
                    class="flex h-8 w-8 items-center justify-center p-1"
                    @click="selectEmoji(emoji)"
                  >
                    {{ emoji }}
                  </Button>
                </div>
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
