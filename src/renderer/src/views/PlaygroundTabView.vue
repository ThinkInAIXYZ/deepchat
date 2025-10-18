<template>
  <div class="w-full h-full overflow-y-auto bg-white/80 dark:bg-zinc-950/80">
    <div class="mx-auto max-w-6xl py-8 px-6 space-y-12">
      <header class="space-y-3">
        <h1 class="text-3xl font-semibold tracking-tight">Shadcn Playground</h1>
        <p class="text-muted-foreground">
          Explore freshly installed @shadcn/ui components. These examples are for internal testing
          only.
        </p>
      </header>

      <section v-for="section in sections" :key="section.title" class="space-y-6">
        <div class="space-y-2">
          <h2 class="text-2xl font-semibold tracking-tight">{{ section.title }}</h2>
          <p class="text-sm text-muted-foreground">{{ section.description }}</p>
        </div>

        <div
          class="grid gap-6"
          :class="section.columns === 2 ? 'md:grid-cols-2' : 'md:grid-cols-1'"
        >
          <component
            :is="section.component"
            v-for="demo in section.demos"
            :key="demo.title"
            :title="demo.title"
            :description="demo.description"
            :component-name="demo.componentName"
            :full-width="demo.fullWidth ?? false"
            :demo="demo.render"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DemoSection from './playground/DemoSection.vue'
import AccordionDemo from './playground/demos/AccordionDemo.vue'
import ButtonGroupDemo from './playground/demos/ButtonGroupDemo.vue'
import CardDemo from './playground/demos/CardDemo.vue'
import DialogDemo from './playground/demos/DialogDemo.vue'
import EmptyDemo from './playground/demos/EmptyDemo.vue'
import FieldDemo from './playground/demos/FieldDemo.vue'
import FormDemo from './playground/demos/FormDemo.vue'
import InputGroupDemo from './playground/demos/InputGroupDemo.vue'
import ItemDemo from './playground/demos/ItemDemo.vue'
import KbdDemo from './playground/demos/KbdDemo.vue'
import PopoverDemo from './playground/demos/PopoverDemo.vue'
import SelectDemo from './playground/demos/SelectDemo.vue'
import SpinnerDemo from './playground/demos/SpinnerDemo.vue'
import TabsDemo from './playground/demos/TabsDemo.vue'
import ThinkContentDemo from './playground/demos/ThinkContentDemo.vue'
import MessageListDemo from './playground/demos/MessageListDemo.vue'

const sections = computed(() => [
  {
    title: 'Forms & Inputs',
    description:
      'Combination of input primitives like buttons, inputs, textarea, checkbox, switch.',
    columns: 2,
    component: DemoSection,
    demos: [
      {
        title: 'Form Elements',
        description: 'Basic form layout using button, input, textarea, checkbox, and switch.',
        componentName: '@shadcn/components/ui',
        render: FormDemo
      },
      {
        title: 'Field layouts',
        description: 'Compose labels, descriptions, and validation with field primitives.',
        componentName: '@shadcn/components/ui/field',
        render: FieldDemo
      },
      {
        title: 'Input group',
        description: 'Addons, buttons, and helpers aligned with a single control.',
        componentName: '@shadcn/components/ui/input-group',
        render: InputGroupDemo
      }
    ]
  },
  {
    title: 'Navigation',
    description: 'Tabs, accordions, and other navigation helpers.',
    columns: 2,
    component: DemoSection,
    demos: [
      {
        title: 'Tabs',
        description: 'Horizontal tab navigation.',
        componentName: '@shadcn/components/ui/tabs',
        render: TabsDemo
      },
      {
        title: 'Accordion',
        description: 'Disclosure interface built on accordion primitives.',
        componentName: '@shadcn/components/ui/accordion',
        render: AccordionDemo
      }
    ]
  },
  {
    title: 'Feedback & Overlays',
    description: 'Dialog, popover, and other overlay components.',
    columns: 2,
    component: DemoSection,
    demos: [
      {
        title: 'Dialog',
        description: 'A modal dialog with header, content, and footer.',
        componentName: '@shadcn/components/ui/dialog',
        render: DialogDemo
      },
      {
        title: 'Popover',
        description: 'Popover anchored to trigger with focus management.',
        componentName: '@shadcn/components/ui/popover',
        render: PopoverDemo
      },
      {
        title: 'Spinner',
        description: 'Lightweight loading indicator available in multiple sizes.',
        componentName: '@shadcn/components/ui/spinner',
        render: SpinnerDemo
      }
    ]
  },
  {
    title: 'Content & Display',
    description: 'Cards and separators for grouping content.',
    columns: 2,
    component: DemoSection,
    demos: [
      {
        title: 'Card',
        description: 'Card layout with header, content, and footer.',
        componentName: '@shadcn/components/ui/card',
        render: CardDemo
      },
      {
        title: 'Think Content',
        description: 'Collapsible reasoning block used for model thoughts.',
        componentName: '@/components/think-content',
        render: ThinkContentDemo
      },
      {
        title: 'Message List Simulator',
        description:
          'Stream long reasoning output with adjustable typing speed and viewport to study auto-scroll.',
        componentName: '@/components/message/MessageList.vue',
        render: MessageListDemo,
        fullWidth: true
      },
      {
        title: 'Item',
        description: 'Flexible list row with media, actions, and metadata.',
        componentName: '@shadcn/components/ui/item',
        render: ItemDemo
      }
    ]
  },
  {
    title: 'Selection Controls',
    description: 'Select menus with options.',
    columns: 2,
    component: DemoSection,
    demos: [
      {
        title: 'Select',
        description: 'Select dropdown with label and helper text.',
        componentName: '@shadcn/components/ui/select',
        render: SelectDemo
      }
    ]
  },
  {
    title: 'Shortcuts & States',
    description: 'Toolbar groups, keyboard hints, and empty states for application scaffolding.',
    columns: 2,
    component: DemoSection,
    demos: [
      {
        title: 'Button group',
        description: 'Organize related actions with toolbar-style groups.',
        componentName: '@shadcn/components/ui/button-group',
        render: ButtonGroupDemo
      },
      {
        title: 'Keyboard shortcuts',
        description: 'Display shortcut helpers with accessible keycaps.',
        componentName: '@shadcn/components/ui/kbd',
        render: KbdDemo
      },
      {
        title: 'Empty state',
        description: 'Pre-built layout for zero-data scenarios.',
        componentName: '@shadcn/components/ui/empty',
        render: EmptyDemo
      }
    ]
  }
])
</script>

<style scoped></style>
